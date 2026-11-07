document.addEventListener("DOMContentLoaded", function () {
  const settingsMenu = document.getElementById("settings-menu");
  settingsMenu.innerHTML = `
  <h2>Settings</h2>
  <div class="settings-tabs">
    <button class="tab-button active" id="proxy-tab"><i class="fas fa-network-wired"></i> Proxy</button>
    <button class="tab-button" id="cloak-tab"><i class="fas fa-user-secret"></i> Cloak</button>
    <button class="tab-button" id="appearance-tab"><i class="fas fa-palette"></i> Appearance</button>
    <button class="tab-button" id="info-tab"><i class="fas fa-info"></i> Info</button>
  </div>
  <div id="proxy-content" class="tab-content active">
    <label for="transport-selector">Transport</label>
    <p>Transport is how the proxy will send information.</p>
    <div class="transport-selector">
      <div class="transport-selected">Libcurl</div>
      <div class="transport-options">
        <div>Libcurl</div>
        <div>Epoxy</div>
      </div>
    </div>
    <label for="wisp-server">Wisp Server</label>
    <p>Enter a different Wisp Server to connect to.</p>
    <p>Recommended to keep this as default.</p>
    <input type="text" id="wisp-server" placeholder="Wisp Server URL Here..." autocomplete="off">
    <button id="save-wisp-url">Save</button>
  </div>
  <div id="cloak-content" class="tab-content">
    <label for="aboutblank-toggle">About:Blank</label>
    <p>Turn this on to go into about:blank every time the page loads (Recommended).</p>
    <input type="checkbox" id="aboutblank-toggle">
  </div>
  <div id="appearance-content" class="tab-content">
    <label for="navbar-toggle">Navigation Bar</label>
    <p>Keep this on for the navigation bar when searching (Recommended).</p>
    <input type="checkbox" id="navbar-toggle">
  </div>
  <div id="info-content" class="tab-content">
    <label>BlackWaves Version 1.0.0</label>
    <label>Made by yaanscoat</label>
    <label onmouseover="this.querySelector('span').style.color='lime'" onmouseout="this.querySelector('span').style.color='green'">
      Server Status: <span style="color: green; transition: color 0.3s ease;">Running</span>
    </label>
    <div style="display: flex; gap: 10px; justify-content: left; align-items: left; margin-top: 10px; margin-bottom: -20px;">
      <label><a href="https://discord.gg/y2X5RtTSe" target="_blank" class="hover-link"><i class="fab fa-discord" style="font-size: 20px;"></i></a></label>
      <label><a href="https://github.com/yaanscoat/blackwaves" target="_blank" class="hover-link"><i class="fab fa-github" style="font-size: 20px;"></i></a></label>
    </div>
  </div>
  <button id="close-settings"><i class="fas fa-times"></i></button>
  `;

  const transportSelected = document.querySelector(".transport-selected");
  const transportOptions = document.querySelector(".transport-options");
  const wispInput = document.getElementById("wisp-server");
  const aboutBlankToggle = document.getElementById("aboutblank-toggle");
  const navbarToggle = document.getElementById("navbar-toggle");
  const defaultWispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/w/`;

  transportSelected.textContent = localStorage.getItem("transport") === "epoxy" ? "Epoxy" : "Libcurl";
  wispInput.value = localStorage.getItem("customWispUrl") || defaultWispUrl;
  aboutBlankToggle.checked = localStorage.getItem("aboutBlankChecked") === "true";
  navbarToggle.checked = localStorage.getItem("navbarToggled") !== "false";

  function toggleSettingsMenu() {
    if (settingsMenu.classList.contains("open")) {
      settingsMenu.classList.add("close");
      setTimeout(() => settingsMenu.classList.remove("open", "close"), 300);
    } else {
      settingsMenu.classList.add("open");
      setTimeout(() => settingsMenu.classList.remove("close"), 300);
    }
  }

  document.getElementById("settings-icon").addEventListener("click", (event) => {
    event.preventDefault();
    toggleSettingsMenu();
  });
  document.getElementById("close-settings").addEventListener("click", toggleSettingsMenu);

  document.querySelectorAll(".tab-button").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab-button, .tab-content").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.id.replace("-tab", "-content")).classList.add("active");
    });
  });

  transportSelected.addEventListener("click", (event) => {
    event.stopPropagation();
    transportOptions.classList.toggle("transport-show");
    transportSelected.classList.toggle("transport-arrow-active");
  });

  transportOptions.querySelectorAll("div").forEach((option) => {
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      const name = option.textContent;
      transportSelected.textContent = name;
      transportOptions.classList.remove("transport-show");
      transportSelected.classList.remove("transport-arrow-active");
      localStorage.setItem("transport", name.toLowerCase());
      showToast(`Transport successfully changed to ${name}`);
      location.reload();
    });
  });

  function isValidWispUrl(url) {
    try {
      const protocol = new URL(url).protocol;
      return (protocol === "wss:" || protocol === "ws:") && url.endsWith("/");
    } catch {
      return false;
    }
  }

  document.getElementById("save-wisp-url").addEventListener("click", () => {
    const url = wispInput.value.trim();
    if (isValidWispUrl(url)) {
      localStorage.setItem("customWispUrl", url);
      showToast(`WISP URL successfully updated to: ${url}`);
    } else {
      localStorage.setItem("customWispUrl", defaultWispUrl);
      wispInput.value = defaultWispUrl;
      showToast("Invalid URL. Reverting back to default...", "error", "times-circle");
    }
    location.reload();
  });

  navbarToggle.addEventListener("change", () => {
    localStorage.setItem("navbarToggled", navbarToggle.checked);
    if (navbarToggle.checked) {
      showToast("Navigation Bar is now enabled.");
    } else {
      showToast("Navigation Bar is now disabled.", "error", "times-circle");
    }
  });

  aboutBlankToggle.addEventListener("change", () => {
    localStorage.setItem("aboutBlankChecked", aboutBlankToggle.checked);
    if (aboutBlankToggle.checked) {
      showToast("About:Blank is now enabled.");
    } else {
      showToast("About:Blank is now disabled.", "error", "times-circle");
    }
    openAboutBlank();
  });

  function openAboutBlank() {
    let inFrame;
    try {
      inFrame = window !== top;
    } catch {
      inFrame = true;
    }
    if (localStorage.getItem("aboutBlankChecked") !== "true" || inFrame) return;

    const title = localStorage.getItem("siteTitle") || "🌊 Google";
    const icon = localStorage.getItem("faviconURL") || "https://www.google.com/favicon.ico";
    const popup = window.open("", "_blank");
    if (!popup || popup.closed) {
      alert("Failed to load automask. Please allow popups and try again.");
      return;
    }
    popup.document.head.innerHTML = `<title>${title}</title><link rel="icon" href="${icon}">`;
    popup.document.body.innerHTML = `<iframe style="height: 100%; width: 100%; border: none; position: fixed; top: 0; right: 0; left: 0; bottom: 0;" src="/"></iframe>`;
    window.location.replace("https://bisd.schoology.com/home");
  }

  window.addEventListener("load", openAboutBlank);
});
