let currentLocation = null;

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
  const lat = document.getElementById("nearbyLat").value;
  const lng = document.getElementById("nearbyLng").value;
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
      displayNearbyResults(data);
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

function displayNearbyResults(data) {
  const cacheTag = data.from_cache
    ? '<span class="badge cache">💾 Cached</span>'
    : '<span class="badge">🔄 Live</span>';

  document.getElementById("nearbyInfo").innerHTML = `
                <p><strong>Found ${data.count} places</strong> ${cacheTag}</p>
            `;

  const placesGrid = document.getElementById("placesGrid");
  placesGrid.innerHTML = data.places
    .map(
      (place) => `
                <div class="place-card">
                    <h4>${place.name}</h4>
                    <p>📍 ${place.address || "No address"}</p>
                    ${
                      place.rating
                        ? `<p class="rating">⭐ ${place.rating} (${
                            place.user_ratings_total || 0
                          } reviews)</p>`
                        : ""
                    }
                    <p style="font-size: 12px; color: #999;">${place.types
                      .slice(0, 2)
                      .join(", ")}</p>
                </div>
            `
    )
    .join("");

  document.getElementById("resultNearby").classList.add("active");
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
