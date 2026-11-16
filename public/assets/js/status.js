/* Live status: ping, active client counter and server location (bottom of the home page). */
(function () {
  const pingText = document.querySelector('#ping-display span');
  const countEl = document.getElementById('client-count');
  const locationEl = document.getElementById('location-text');
  let retry = 1000;

  function setLocation(loc) {
    if (loc) locationEl.textContent = loc;
  }

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/w/ping`);
    ws.onopen = () => {
      retry = 1000;
      pingText.textContent = 'Measuring...';
    };
    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
      else if (data.type === 'latency') pingText.textContent = `${data.latency} ms`;
      else if (data.type === 'clients') countEl.textContent = data.count;
      else if (data.type === 'location') setLocation(data.location);
    };
    ws.onclose = () => {
      pingText.textContent = 'Reconnecting...';
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  }

  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      setLocation(info.location);
      countEl.textContent = info.clients || 1;
    })
    .catch(() => {});

  connect();
})();
