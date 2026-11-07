(function () {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/w/ping`;
  
  const pingDisplay = document.getElementById("pingDisplay");
  const ws = new WebSocket(wsUrl);

  ws.onopen = function () {
    pingDisplay.innerHTML = '<i class="fas fa-wifi"></i> Ping: Waiting...';
  };

  ws.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "ping" && data.timestamp) {
        ws.send(JSON.stringify({ type: "pong", timestamp: data.timestamp }));
      }
      if (data.type === "latency" && typeof data.latency === "number") {
        pingDisplay.innerHTML = '<i class="fas fa-wifi"></i> Ping: ' + data.latency + ' ms';
      }
    } catch (err) {
      console.error("Error parsing message:", err);
    }
  };

  ws.onerror = function () {
    pingDisplay.innerHTML = '<i class="fas fa-wifi"></i> Ping: Error';
  };

  ws.onclose = function () {
    pingDisplay.innerHTML = '<i class="fas fa-wifi"></i> Ping: Disconnected';
  };
})();
