/* Tab cloaking: preset titles/icons, about:blank + blob: launching, panic key. */
(function () {
  const fav = (domain) => `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

  const PRESETS = [
    { id: 'google', name: 'Google', title: 'Google', icon: fav('google.com') },
    { id: 'classroom', name: 'Google Classroom', title: 'Home', icon: 'https://ssl.gstatic.com/classroom/favicon.png' },
    { id: 'docs', name: 'Google Docs', title: 'Untitled document - Google Docs', icon: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' },
    { id: 'sheets', name: 'Google Sheets', title: 'Untitled spreadsheet - Google Sheets', icon: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico' },
    { id: 'slides', name: 'Google Slides', title: 'Untitled presentation - Google Slides', icon: 'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico' },
    { id: 'forms', name: 'Google Forms', title: 'Untitled form - Google Forms', icon: 'https://ssl.gstatic.com/docs/spreadsheets/forms/favicon_qp2.png' },
    { id: 'drive', name: 'Google Drive', title: 'My Drive - Google Drive', icon: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png' },
    { id: 'gmail', name: 'Gmail', title: 'Inbox - Gmail', icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
    { id: 'calendar', name: 'Google Calendar', title: 'Google Calendar', icon: 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico' },
    { id: 'meet', name: 'Google Meet', title: 'Google Meet', icon: fav('meet.google.com') },
    { id: 'translate', name: 'Google Translate', title: 'Google Translate', icon: fav('translate.google.com') },
    { id: 'canvas', name: 'Canvas', title: 'Dashboard', icon: fav('instructure.com') },
    { id: 'schoology', name: 'Schoology', title: 'Home | Schoology', icon: fav('schoology.com') },
    { id: 'clever', name: 'Clever', title: 'Clever | Portal', icon: fav('clever.com') },
    { id: 'khan', name: 'Khan Academy', title: 'Dashboard | Khan Academy', icon: fav('khanacademy.org') },
    { id: 'desmos', name: 'Desmos', title: 'Desmos | Graphing Calculator', icon: fav('desmos.com') },
    { id: 'quizlet', name: 'Quizlet', title: 'Your Sets | Quizlet', icon: fav('quizlet.com') },
    { id: 'wikipedia', name: 'Wikipedia', title: 'Wikipedia, the free encyclopedia', icon: fav('wikipedia.org') },
    { id: 'britannica', name: 'Britannica', title: 'Encyclopedia Britannica | Britannica', icon: fav('britannica.com') },
    { id: 'zoom', name: 'Zoom', title: 'Zoom Workplace', icon: fav('zoom.us') },
    { id: 'teams', name: 'Microsoft Teams', title: 'Microsoft Teams', icon: fav('teams.microsoft.com') },
    { id: 'outlook', name: 'Outlook', title: 'Mail - Outlook', icon: fav('outlook.live.com') },
    { id: 'office', name: 'Microsoft 365', title: 'Home | Microsoft 365', icon: fav('office.com') },
    { id: 'powerschool', name: 'PowerSchool', title: 'Grades and Attendance', icon: fav('powerschool.com') },
    { id: 'infinitecampus', name: 'Infinite Campus', title: 'Campus Student', icon: fav('infinitecampus.com') },
    { id: 'ixl', name: 'IXL', title: 'IXL | Dashboard', icon: fav('ixl.com') },
    { id: 'edpuzzle', name: 'Edpuzzle', title: 'Edpuzzle', icon: fav('edpuzzle.com') },
    { id: 'kahoot', name: 'Kahoot!', title: 'Kahoot!', icon: fav('kahoot.it') },
    { id: 'quizizz', name: 'Quizizz', title: 'Quizizz', icon: fav('quizizz.com') },
    { id: 'blooket', name: 'Blooket', title: 'Blooket', icon: fav('blooket.com') },
    { id: 'gimkit', name: 'Gimkit', title: 'Gimkit', icon: fav('gimkit.com') },
    { id: 'newsela', name: 'Newsela', title: 'Newsela | Binder', icon: fav('newsela.com') },
    { id: 'commonlit', name: 'CommonLit', title: 'CommonLit', icon: fav('commonlit.org') },
    { id: 'nearpod', name: 'Nearpod', title: 'Nearpod', icon: fav('nearpod.com') },
    { id: 'peardeck', name: 'Pear Deck', title: 'Pear Deck', icon: fav('peardeck.com') },
    { id: 'seesaw', name: 'Seesaw', title: 'Seesaw', icon: fav('seesaw.me') },
    { id: 'brainpop', name: 'BrainPOP', title: 'BrainPOP', icon: fav('brainpop.com') },
    { id: 'deltamath', name: 'DeltaMath', title: 'DeltaMath', icon: fav('deltamath.com') },
    { id: 'duolingo', name: 'Duolingo', title: 'Duolingo - The world\'s best way to learn a language', icon: fav('duolingo.com') },
    { id: 'youtube', name: 'YouTube', title: 'YouTube', icon: fav('youtube.com') },
  ];

  const ORIGINAL = { title: 'blackwaves', icon: '/favicon.ico' };
  const s = () => BW.settings;

  function cloakData() {
    const preset = s().get('cloakPreset');
    if (preset === 'none') return null;
    if (preset === 'custom') {
      const title = s().get('cloakTitle');
      const icon = s().get('cloakIcon');
      return title || icon ? { title: title || ORIGINAL.title, icon: icon || ORIGINAL.icon } : null;
    }
    const p = PRESETS.find((x) => x.id === preset);
    return p ? { title: p.title, icon: p.icon } : null;
  }

  // When running inside an about:blank/blob launcher, the visible tab is the parent document.
  function targetDoc() {
    try {
      if (window.top !== window && window.top.document && window.top.__bwLauncher) return window.top.document;
    } catch {}
    return document;
  }

  function setTab(title, icon) {
    const doc = targetDoc();
    doc.title = title;
    let link = doc.querySelector('link[rel~="icon"]');
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
    }
    link.href = icon;
  }

  let liveTitle = ORIGINAL.title;
  function apply() {
    const data = cloakData();
    const mode = s().get('cloakMode');
    if (!data || (mode === 'away' && !document.hidden)) {
      setTab(liveTitle, ORIGINAL.icon);
    } else {
      setTab(data.title, data.icon);
    }
  }

  function inLauncher() {
    try {
      return window.top !== window;
    } catch {
      return true;
    }
  }

  function launcherHtml() {
    const data = cloakData() || { title: 'Google', icon: fav('google.com') };
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title><link rel="icon" href="${esc(data.icon)}"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{border:0;width:100%;height:100%;position:fixed;inset:0}</style></head><body><script>window.__bwLauncher=true;<\/script><iframe src="${esc(location.origin + '/')}" allow="fullscreen; clipboard-read; clipboard-write; autoplay; encrypted-media" allowfullscreen></iframe></body></html>`;
  }

  function launch(mode) {
    mode = mode || s().get('launchMode');
    if (mode === 'none') return false;
    let win;
    if (mode === 'blob') {
      const blob = new Blob([launcherHtml()], { type: 'text/html' });
      win = window.open(URL.createObjectURL(blob), '_blank');
    } else {
      win = window.open('about:blank', '_blank');
      if (win) {
        win.document.open();
        win.document.write(launcherHtml());
        win.document.close();
      }
    }
    if (!win || win.closed) return false;
    const redirect = s().get('redirectUrl');
    if (redirect) location.replace(redirect);
    return true;
  }

  function promptLaunch() {
    const wrap = document.createElement('div');
    wrap.className = 'launch-prompt';
    wrap.innerHTML = `<div class="launch-card"><i class="fa-solid fa-user-secret"></i><h3>Launch cloaked tab</h3><p>Your browser blocked the automatic launch. Click below to open blackwaves in a cloaked ${s().get('launchMode') === 'blob' ? 'blob:' : 'about:blank'} tab.</p><div class="launch-actions"><button class="bw-btn" data-act="skip">Stay here</button><button class="bw-btn primary" data-act="go">Launch</button></div></div>`;
    wrap.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'go') {
        if (!launch()) BW.toast && BW.toast('Allow pop-ups for this site, then try again.', 'warning');
        else wrap.remove();
      } else if (act === 'skip') wrap.remove();
    });
    document.body.appendChild(wrap);
  }

  function autoLaunch() {
    if (!s().get('autoLaunch') || s().get('launchMode') === 'none' || inLauncher()) return;
    if (!launch()) promptLaunch();
  }

  document.addEventListener('visibilitychange', apply);
  function handleKey(e) {
    const key = s().get('panicKey');
    if (!key || e.key !== key) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    const url = s().get('panicUrl') || 'https://classroom.google.com';
    try {
      window.top.location.replace(url);
    } catch {
      location.replace(url);
    }
  }
  document.addEventListener('keydown', handleKey);
  ['cloakPreset', 'cloakTitle', 'cloakIcon', 'cloakMode'].forEach((k) => s().on(k, apply));

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    autoLaunch();
  });

  BW.cloak = {
    PRESETS,
    apply,
    launch,
    handleKey,
    inLauncher,
    setLiveTitle(title) {
      liveTitle = title || ORIGINAL.title;
      apply();
    },
  };
})();
