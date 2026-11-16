/* Toggle Eruda devtools inside the proxied frame. */
(function () {
  const btn = document.getElementById('nav-eruda');
  const notice = document.getElementById('erudaLoadingScreen');

  btn.addEventListener('click', () => {
    const frame = BW.tabs.activeFrame();
    if (!frame) return BW.toast('Open a page first.', 'info');
    let win, doc;
    try {
      win = frame.contentWindow;
      doc = frame.contentDocument;
    } catch {
      return BW.toast('Developer tools are not available on this page.', 'error');
    }
    if (!doc || !doc.head) return BW.toast('Open a page first.', 'info');

    if (win.eruda && win.eruda._isInit) {
      win.eruda.destroy();
      return;
    }
    notice.hidden = false;
    const timeout = setTimeout(() => {
      notice.hidden = true;
      BW.toast('Developer tools took too long to load.', 'error');
    }, 10000);
    const script = doc.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js';
    script.onload = () => {
      clearTimeout(timeout);
      notice.hidden = true;
      try {
        win.eruda.init();
        win.eruda.show();
      } catch (e) {
        BW.toast('Developer tools failed to start on this page.', 'error');
      }
    };
    script.onerror = () => {
      clearTimeout(timeout);
      notice.hidden = true;
      BW.toast('Could not load developer tools.', 'error');
    };
    doc.head.appendChild(script);
  });
})();
