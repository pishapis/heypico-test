let currentLocation = null;
let nearbyMap = null;
let nearbyMarkers = [];

// Check health status
checkHealth();
setInterval(checkHealth, 30000);

async function checkHealth() {
  try {
    const response = await fetch("http://localhost:5000/api/health");
    const data = await response.json();

    updateStatus("ollama", data.ollama);
    updateStatus("api", data.google_maps_api);
  } catch (error) {
    console.error("Health check failed:", error);
  }
}

function updateStatus(type, isOnline) {
  const status = document.getElementById(`${type}Status`);
  const text = document.getElementById(`${type}Text`);

  if (isOnline) {
    status.className = "status-indicator online";
    text.textContent = type === "ollama" ? "Online" : "Configured";
  } else {
    status.className = "status-indicator offline";
    text.textContent = type === "ollama" ? "Offline" : "Not configured";
  }
}

function switchTab(tab) {
  // Update tab buttons
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  event.target.classList.add("active");

  // Update tab content
  document
    .querySelectorAll(".tab-content")
    .forEach((tc) => tc.classList.remove("active"));
  document.getElementById(`${tab}Tab`).classList.add("active");
}

function setExample(text, type = "location") {
  document.getElementById("promptInput").value = text;
  document.getElementById("queryType").value = type;
}

function setReverseExample(lat, lng) {
  document.getElementById("reverseLat").value = lat;
  document.getElementById("reverseLng").value = lng;
}

async function searchLocation() {
  const prompt = document.getElementById("promptInput").value.trim();
  const queryType = document.getElementById("queryType").value;

  if (!prompt) {
    showError("error", "Please enter a location to search");
    return;
  }

  hideResults("result", "error");
  showLoading("loading", true);
  document.getElementById("searchBtn").disabled = true;

  try {
    const response = await fetch("http://localhost:5000/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, type: queryType }),
    });

    const data = await response.json();

    if (data.success) {
      currentLocation = data;
      displayResult(data);
    } else {
      showError("error", data.error || "Location not found");
    }
  } catch (error) {
    showError(
      "error",
      "Failed to connect to server. Make sure the backend is running."
    );
  } finally {
    showLoading("loading", false);
    document.getElementById("searchBtn").disabled = false;
  }
}

function displayResult(data) {
  const cacheTag = data.from_cache
    ? '<span class="badge cache">💾 Cached</span>'
    : '<span class="badge">🔄 Live</span>';

  document.getElementById("locationInfo").innerHTML = `
                <p><strong>Location:</strong> ${data.location} ${cacheTag}</p>
                <p><strong>Address:</strong> ${data.formatted_address}</p>
                <p><strong>Coordinates:</strong> ${data.coordinates.lat}, ${
    data.coordinates.lng
  }</p>
                <p><strong>Type:</strong> ${data.types
                  .slice(0, 3)
                  .join(", ")}</p>
            `;

  const mapContainer = document.getElementById("mapContainer");
  mapContainer.innerHTML = `<div id="googleMap" style="width: 100%; height: 100%;"></div>`;

  loadGoogleMapsAPI(data.api_key, () => {
    initMap(data.coordinates, data.location);
  });

  document.getElementById("openMapsLink").href = data.map_url;
  document.getElementById("result").classList.add("active");
}

function loadGoogleMapsAPI(apiKey, callback) {
  if (window.google && window.google.maps) {
    callback();
    return;
  }

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
  script.async = true;
  script.defer = true;
  script.onload = callback;
  script.onerror = () => showError("error", "Failed to load Google Maps");
  document.head.appendChild(script);
}

function initMap(coords, locationName) {
  try {
    const map = new google.maps.Map(document.getElementById("googleMap"), {
      center: coords,
      zoom: 16,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
    });

    new google.maps.Marker({
      position: coords,
      map: map,
      title: locationName,
      animation: google.maps.Animation.DROP,
    });
  } catch (error) {
    showError("error", "Failed to initialize map: " + error.message);
  }
}

function findNearby() {
  if (!currentLocation) return;

  document.getElementById("nearbyLat").value = currentLocation.coordinates.lat;
  document.getElementById("nearbyLng").value = currentLocation.coordinates.lng;
  switchTab("nearby");
  document.querySelector("[onclick=\"switchTab('nearby')\"]").click();
}

async function searchNearby() {
  const lat = parseFloat(document.getElementById("nearbyLat").value);
  const lng = parseFloat(document.getElementById("nearbyLng").value);
  const type = document.getElementById("placeType").value;

  if (!lat || !lng) {
    showError("errorNearby", "Please enter coordinates");
    return;
  }

  hideResults("resultNearby", "errorNearby");
  showLoading("loadingNearby", true);
  document.getElementById("nearbyBtn").disabled = true;

  try {
    const response = await fetch("http://localhost:5000/api/places/nearby", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, type, radius: 1500 }),
    });

    const data = await response.json();

    if (data.success) {
      displayNearbyResults(data, { lat, lng });
    } else {
      showError("errorNearby", data.error || "No places found");
    }
  } catch (error) {
    showError("errorNearby", "Failed to search nearby places");
  } finally {
    showLoading("loadingNearby", false);
    document.getElementById("nearbyBtn").disabled = false;
  }
}

function displayNearbyResults(data, centerCoords) {
  const cacheTag = data.from_cache
    ? '<span class="badge cache">💾 Cached</span>'
    : '<span class="badge">🔄 Live</span>';

  document.getElementById("nearbyInfo").innerHTML = `
    <p><strong>Found ${data.count} ${data.count === 1 ? 'place' : 'places'} nearby</strong> ${cacheTag}</p>
    <p style="font-size: 13px; color: #666;">📍 Center: ${centerCoords.lat.toFixed(6)}, ${centerCoords.lng.toFixed(6)}</p>
  `;

  // Create map container
  const placesGrid = document.getElementById("placesGrid");
  placesGrid.innerHTML = `
    <div id="nearbyMapContainer">
      <div class="map-loading">
        🗺️ Loading map...
      </div>
    </div>
    <div id="nearbyPlacesList"></div>
  `;

  // Get API key
  const apiKey = data.api_key || currentLocation?.api_key;
  
  if (!apiKey) {
    showError("errorNearby", "Google Maps API key not available");
    return;
  }

  // Initialize map
  if (window.google && window.google.maps) {
    initNearbyMap(centerCoords, data.places);
  } else {
    loadGoogleMapsAPI(apiKey, () => {
      initNearbyMap(centerCoords, data.places);
    });
  }

  // Display places list
  const placesList = document.getElementById("nearbyPlacesList");
  
  if (data.places.length === 0) {
    placesList.innerHTML = '<div class="no-results">😔 No places found nearby. Try increasing the search radius.</div>';
  } else {
    placesList.innerHTML = data.places
      .map((place, index) => {
        const placeTypes = place.types
          .filter(t => !['point_of_interest', 'establishment'].includes(t))
          .slice(0, 2)
          .join(', ') || 'Place';
          
        return `
          <div class="place-card" onclick="focusOnMarker(${index})" title="Click to view on map">
            <h4>
              <span class="place-number">${index + 1}</span>
              ${place.name || 'Unnamed Place'}
            </h4>
            
            <p>📍 ${place.address || "Address not available"}</p>
            
            ${place.rating 
              ? `<p class="rating">⭐ ${place.rating} / 5.0 ${place.user_ratings_total ? `(${place.user_ratings_total} reviews)` : ''}</p>`
              : '<p style="color: #999; font-size: 13px;">No ratings yet</p>'
            }
            
            ${place.open_now !== undefined && place.open_now !== null
              ? `<span class="place-status ${place.open_now ? 'open' : 'closed'}">
                  ${place.open_now ? '🟢 Open Now' : '🔴 Closed'}
                </span>`
              : ''
            }
            
            <div class="place-types">${placeTypes}</div>
            
            <a href="https://www.google.com/maps/place/?q=place_id:${place.place_id}" 
               target="_blank" 
               class="place-link"
               onclick="event.stopPropagation()"
               title="Open in Google Maps">
              🗺️ View on Google Maps
            </a>
          </div>
        `;
      })
      .join("");
  }

  document.getElementById("resultNearby").classList.add("active");
}

function initNearbyMap(centerCoords, places) {
  try {
    const mapContainer = document.getElementById("nearbyMapContainer");
    
    if (!mapContainer) {
      console.error("Map container not found");
      return;
    }

    if (!window.google || !window.google.maps) {
      console.error("Google Maps API not loaded");
      mapContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #ffebee; color: #c62828; flex-direction: column; gap: 10px;">
          <div style="font-size: 48px;">⚠️</div>
          <div style="font-weight: 600;">Google Maps failed to load</div>
          <div style="font-size: 13px; opacity: 0.8;">Check your internet connection</div>
        </div>
      `;
      return;
    }

    // Clear loading state
    mapContainer.innerHTML = '';

    // Clear previous markers
    nearbyMarkers.forEach((marker) => marker.setMap(null));
    nearbyMarkers = [];

    // Create map with better styling
    nearbyMap = new google.maps.Map(mapContainer, {
      center: centerCoords,
      zoom: 14,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
        position: google.maps.ControlPosition.TOP_RIGHT,
      },
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }]
        }
      ]
    });

    // Add center marker (search location)
    const centerMarker = new google.maps.Marker({
      position: centerCoords,
      map: nearbyMap,
      title: "Search Center",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: "#4285F4",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
      zIndex: 1000,
    });

    // Add info window for center
    const centerInfo = new google.maps.InfoWindow({
      content: `
        <div style="padding: 10px;">
          <h4 style="margin: 0 0 8px 0; color: #4285F4;">📍 Search Center</h4>
          <p style="margin: 0; font-size: 13px; color: #666;">Lat: ${centerCoords.lat.toFixed(6)}<br>Lng: ${centerCoords.lng.toFixed(6)}</p>
        </div>
      `,
    });

    centerMarker.addListener("click", () => {
      nearbyMarkers.forEach((m) => {
        if (m.infoWindow) m.infoWindow.close();
      });
      centerInfo.open(nearbyMap, centerMarker);
    });

    // Add circle to show search radius
    new google.maps.Circle({
      map: nearbyMap,
      center: centerCoords,
      radius: 1500, // 1.5km
      fillColor: "#4285F4",
      fillOpacity: 0.1,
      strokeColor: "#4285F4",
      strokeOpacity: 0.3,
      strokeWeight: 1,
    });

    // Add bounds to fit all markers
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(centerCoords);

    // Add markers for each place
    places.forEach((place, index) => {
      if (place.location) {
        const marker = new google.maps.Marker({
          position: place.location,
          map: nearbyMap,
          title: place.name,
          label: {
            text: String(index + 1),
            color: "white",
            fontWeight: "bold",
            fontSize: "14px",
          },
          animation: google.maps.Animation.DROP,
        });

        // Rich info window
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 12px; max-width: 250px;">
              <h4 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">${place.name}</h4>
              
              ${place.rating 
                ? `<div style="margin: 8px 0;">
                    <span style="color: #ffa500; font-weight: bold;">⭐ ${place.rating}</span>
                    <span style="color: #999; font-size: 12px;"> ${place.user_ratings_total ? `(${place.user_ratings_total})` : ''}</span>
                  </div>`
                : ''
              }
              
              <p style="margin: 8px 0; font-size: 13px; color: #666;">
                📍 ${place.address || "Address not available"}
              </p>
              
              ${place.open_now !== undefined && place.open_now !== null
                ? `<div style="margin: 8px 0;">
                    <span style="display: inline-block; padding: 4px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; ${
                      place.open_now 
                        ? 'background: #e8f5e9; color: #2e7d32;' 
                        : 'background: #ffebee; color: #c62828;'
                    }">
                      ${place.open_now ? '🟢 Open Now' : '🔴 Closed'}
                    </span>
                  </div>`
                : ''
              }
              
              <a href="https://www.google.com/maps/place/?q=place_id:${place.place_id}" 
                 target="_blank" 
                 style="display: inline-block; margin-top: 10px; padding: 6px 12px; background: #4285f4; color: white; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: 600;">
                Open in Google Maps →
              </a>
            </div>
          `,
        });

        marker.addListener("click", () => {
          nearbyMarkers.forEach((m) => {
            if (m.infoWindow) m.infoWindow.close();
          });
          centerInfo.close();
          infoWindow.open(nearbyMap, marker);
          
          // Smooth pan to marker
          nearbyMap.panTo(marker.getPosition());
        });

        marker.infoWindow = infoWindow;
        nearbyMarkers.push(marker);
        bounds.extend(place.location);
      }
    });

    // Fit map to show all markers with padding
    nearbyMap.fitBounds(bounds, {
      padding: { top: 50, right: 50, bottom: 50, left: 50 }
    });
    
    console.log(`✅ Nearby map initialized with ${places.length} markers`);
  } catch (error) {
    console.error("Failed to initialize nearby map:", error);
    const mapContainer = document.getElementById("nearbyMapContainer");
    if (mapContainer) {
      mapContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #ffebee; color: #c62828; flex-direction: column; gap: 10px;">
          <div style="font-size: 48px;">❌</div>
          <div style="font-weight: 600;">Map initialization failed</div>
          <div style="font-size: 13px; opacity: 0.8;">${error.message}</div>
        </div>
      `;
    }
  }
}

function focusOnMarker(index) {
  if (nearbyMarkers[index] && nearbyMap) {
    nearbyMarkers.forEach((m) => {
      if (m.infoWindow) m.infoWindow.close();
    });
    
    nearbyMap.panTo(nearbyMarkers[index].getPosition());
    nearbyMap.setZoom(17);
    
    google.maps.event.trigger(nearbyMarkers[index], "click");
    
    document.getElementById("nearbyMapContainer").scrollIntoView({ 
      behavior: "smooth", 
      block: "start" 
    });
    
    // Add bounce animation
    nearbyMarkers[index].setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => {
      nearbyMarkers[index].setAnimation(null);
    }, 1400); // 2 bounces
  }
}

async function reverseGeocode() {
  const lat = document.getElementById("reverseLat").value;
  const lng = document.getElementById("reverseLng").value;

  if (!lat || !lng) {
    showError("errorReverse", "Please enter coordinates");
    return;
  }

  hideResults("resultReverse", "errorReverse");
  showLoading("loadingReverse", true);
  document.getElementById("reverseBtn").disabled = true;

  try {
    const response = await fetch("http://localhost:5000/api/geocode/reverse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });

    const data = await response.json();

    if (data.success) {
      displayReverseResult(data);
    } else {
      showError("errorReverse", data.error || "Address not found");
    }
  } catch (error) {
    showError("errorReverse", "Failed to find address");
  } finally {
    showLoading("loadingReverse", false);
    document.getElementById("reverseBtn").disabled = false;
  }
}

function displayReverseResult(data) {
  const cacheTag = data.from_cache
    ? '<span class="badge cache">💾 Cached</span>'
    : '<span class="badge">🔄 Live</span>';

  document.getElementById("reverseInfo").innerHTML = `
                <p><strong>Address:</strong> ${data.formatted_address} ${cacheTag}</p>
                <p><strong>Place ID:</strong> ${data.place_id}</p>
            `;

  document.getElementById("resultReverse").classList.add("active");
}

function showLoading(id, show) {
  document.getElementById(id).classList.toggle("active", show);
}

function hideResults(...ids) {
  ids.forEach((id) => document.getElementById(id).classList.remove("active"));
}

function showError(id, message) {
  const errorDiv = document.getElementById(id);
  errorDiv.textContent = "❌ " + message;
  errorDiv.classList.add("active");
}