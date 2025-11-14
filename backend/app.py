from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_caching import Cache
import requests 
import os
from dotenv import load_dotenv
import json
import hashlib
from functools import wraps
import time

load_dotenv()

app = Flask(__name__, static_folder='../frontend', static_url_path='/')

CORS(app)

# Configure Rate Limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Configure Caching
cache = Cache(app, config={
    'CACHE_TYPE': 'SimpleCache',
    'CACHE_DEFAULT_TIMEOUT': 3600  # 1 hour cache
})

GOOGLE_MAPS_API_KEY = os.getenv('GOOGLE_MAPS_API_KEY')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'llama3.1')
OLLAMA_URL = "http://localhost:11434/api/generate"

# Cache key generator
def generate_cache_key(query_type, query_text):
    """Generate unique cache key for queries"""
    key_string = f"{query_type}:{query_text.lower().strip()}"
    return hashlib.md5(key_string.encode()).hexdigest()

# Performance tracking decorator
def track_performance(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        start_time = time.time()
        result = f(*args, **kwargs)
        end_time = time.time()
        print(f"[PERF] {f.__name__} took {end_time - start_time:.2f}s")
        return result
    return decorated_function

@app.route('/')
def serve_frontend():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/query', methods=['POST'])
@limiter.limit("30 per minute")
@track_performance
def query_llm():
    try:
        data = request.json
        user_prompt = data.get('prompt', '')
        query_type = data.get('type', 'location')
        
        if not user_prompt:
            return jsonify({'error': 'No prompt provided'}), 400
        
        print(f"[REQUEST] User prompt: {user_prompt} | Type: {query_type}")
        
        # Check cache first
        cache_key = generate_cache_key(query_type, user_prompt)
        cached_result = cache.get(cache_key)
        
        if cached_result:
            print(f"[CACHE HIT] Returning cached result")
            cached_result['from_cache'] = True
            return jsonify(cached_result)
        
        print(f"[CACHE MISS] Processing new request")
        
        # Enhanced LLM prompts
        llm_prompts = {
            'location': """Extract the location name from: "{text}"
Rules:
- Return ONLY the location name
- Include city/region if mentioned
- No extra words
Location:""",
            'place': """Extract the place/establishment name from: "{text}"
Rules:
- Return place name and city if mentioned
- For restaurants, cafes, hotels, return full name
- No extra words
Place:""",
            'street': """Extract the street or road name from: "{text}"
Rules:
- Return street name and area/city if mentioned
- Include landmarks if relevant
- No extra words
Street:""",
            'building': """Extract the building or landmark name from: "{text}"
Rules:
- Return building/landmark name
- Include location context if available
- No extra words
Building:"""
        }
        
        llm_prompt = llm_prompts.get(query_type, llm_prompts['location']).format(text=user_prompt)
        
        llm_payload = {
            "model": OLLAMA_MODEL,
            "prompt": llm_prompt,
            "stream": False,
            "options": {
                "temperature": 0.1,
                "num_predict": 50
            }
        }
        
        print("[OLLAMA] Querying LLM...")
        llm_response = requests.post(OLLAMA_URL, json=llm_payload, timeout=30)
        llm_response.raise_for_status()
        
        location = llm_response.json()['response'].strip()
        print(f"[OLLAMA] Extracted: {location}")
        
        # Query Google Maps Geocoding API
        geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
        geocode_params = {
            'address': location,
            'key': GOOGLE_MAPS_API_KEY
        }
        
        print("[GOOGLE] Querying Maps API...")
        geo_response = requests.get(geocode_url, params=geocode_params, timeout=10)
        geo_response.raise_for_status()
        geo_data = geo_response.json()
        
        if geo_data.get('status') == 'OK' and geo_data.get('results'):
            result = geo_data['results'][0]
            coords = result['geometry']['location']
            formatted_address = result['formatted_address']
            place_id = result.get('place_id', '')
            place_types = result.get('types', [])
            
            response_data = {
                'success': True,
                'location': location,
                'formatted_address': formatted_address,
                'coordinates': coords,
                'place_id': place_id,
                'types': place_types,
                'map_url': f"https://www.google.com/maps?q={coords['lat']},{coords['lng']}",
                'place_url': f"https://www.google.com/maps/place/?q=place_id:{place_id}",
                'api_key': GOOGLE_MAPS_API_KEY,
                'from_cache': False
            }
            
            # Cache the result
            cache.set(cache_key, response_data, timeout=3600)
            print(f"[CACHE] Result cached")
            
            return jsonify(response_data)
        else:
            return jsonify({
                'success': False,
                'error': f"Location not found: {geo_data.get('status')}"
            }), 404
            
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timeout. Please try again.'}), 504
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Request error: {str(e)}")
        return jsonify({'error': f'API request failed: {str(e)}'}), 500
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500
 
@app.route('/api/places/nearby', methods=['POST'])
@limiter.limit("20 per minute")
@track_performance
def nearby_places():
    """Search for nearby places using Google Places API"""
    try:
        data = request.json
        lat = data.get('lat')
        lng = data.get('lng')
        place_type = data.get('type', 'restaurant')
        radius = data.get('radius', 1500)
        
        if not lat or not lng:
            return jsonify({'error': 'Coordinates required'}), 400
        
        # Check cache
        cache_key = f"nearby:{lat}:{lng}:{place_type}:{radius}"
        cached_result = cache.get(cache_key)
        
        if cached_result:
            print(f"[CACHE HIT] Nearby places")
            cached_result['from_cache'] = True
            return jsonify(cached_result)
        
        print(f"[GOOGLE] Searching nearby {place_type}...")
        
        # Google Places Nearby Search
        places_url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
        params = {
            'location': f"{lat},{lng}",
            'radius': radius,
            'type': place_type,
            'key': GOOGLE_MAPS_API_KEY
        }
        
        response = requests.get(places_url, params=params, timeout=10)
        response.raise_for_status()
        places_data = response.json()
        
        if places_data.get('status') == 'OK':
            results = places_data.get('results', [])[:10]
            
            simplified_results = [{
                'name': place.get('name'),
                'address': place.get('vicinity'),
                'rating': place.get('rating'),
                'user_ratings_total': place.get('user_ratings_total'),
                'types': place.get('types', []),
                'location': place.get('geometry', {}).get('location'),
                'place_id': place.get('place_id'),
                'open_now': place.get('opening_hours', {}).get('open_now')
            } for place in results]
            
            response_data = {
                'success': True,
                'places': simplified_results,
                'count': len(simplified_results),
                'from_cache': False
            }
            
            # Cache for 2 hours
            cache.set(cache_key, response_data, timeout=7200)
            print(f"[CACHE] Nearby places cached")
            
            return jsonify(response_data)
        else:
            return jsonify({
                'success': False,
                'error': f"Places search failed: {places_data.get('status')}"
            }), 404
            
    except Exception as e:
        print(f"[ERROR] nearby_places: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/geocode/reverse', methods=['POST'])
@limiter.limit("20 per minute")
@track_performance
def reverse_geocode():
    """Reverse geocoding: coordinates to address"""
    try:
        data = request.json
        lat = data.get('lat')
        lng = data.get('lng')
        
        if not lat or not lng:
            return jsonify({'error': 'Coordinates required'}), 400
        
        # Check cache
        cache_key = f"reverse:{lat}:{lng}"
        cached_result = cache.get(cache_key)
        
        if cached_result:
            print(f"[CACHE HIT] Reverse geocode")
            cached_result['from_cache'] = True
            return jsonify(cached_result)
        
        print(f"[GOOGLE] Reverse geocoding...")
        
        geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            'latlng': f"{lat},{lng}",
            'key': GOOGLE_MAPS_API_KEY
        }
        
        response = requests.get(geocode_url, params=params, timeout=10)
        response.raise_for_status()
        geo_data = response.json()
        
        if geo_data.get('status') == 'OK' and geo_data.get('results'):
            result = geo_data['results'][0]
            
            response_data = {
                'success': True,
                'formatted_address': result.get('formatted_address'),
                'address_components': result.get('address_components', []),
                'place_id': result.get('place_id'),
                'from_cache': False
            }
            
            cache.set(cache_key, response_data, timeout=7200)
            print(f"[CACHE] Reverse geocode cached")
            
            return jsonify(response_data)
        else:
            return jsonify({'success': False, 'error': 'Address not found'}), 404
            
    except Exception as e:
        print(f"[ERROR] reverse_geocode: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Check if Ollama and APIs are accessible"""
    health_status = {
        'ollama': False,
        'google_maps_api': bool(GOOGLE_MAPS_API_KEY),
        'cache': True,
        'rate_limiter': True
    }
    
    try:
        response = requests.get("http://localhost:11434/api/tags", timeout=5)
        health_status['ollama'] = response.status_code == 200
    except:
        pass
    
    return jsonify(health_status)

@app.route('/api/cache/stats', methods=['GET'])
def cache_stats():
    """Get cache statistics"""
    return jsonify({
        'cache_type': 'SimpleCache',
        'timeout': '1 hour for location queries, 2 hours for places',
        'info': 'Cache improves performance and reduces API usage'
    })

@app.route('/api/cache/clear', methods=['POST'])
@limiter.limit("5 per hour")
def clear_cache():
    """Clear all cached data"""
    try:
        cache.clear()
        print("[CACHE] Cache cleared")
        return jsonify({'success': True, 'message': 'Cache cleared successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Enhanced LLM Maps Backend Server")
    print("=" * 60)
    print(f"📦 Ollama Model: {OLLAMA_MODEL}")
    print(f"🗺️  Google Maps API: {'✅ Configured' if GOOGLE_MAPS_API_KEY else '❌ Missing'}")
    print(f"⏱️  Rate Limiting: ✅ Enabled (200/day, 50/hour)")
    print(f"💾 Caching: ✅ Enabled (1-2 hour timeout)")
    print(f"🌐 Server: http://localhost:5000")
    print("=" * 60)
    app.run(debug=True, port=5000)