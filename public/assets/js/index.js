document.addEventListener("DOMContentLoaded", () => {
  const iframe = document.getElementById("cool-iframe");
  const searchContainer = document.querySelector(".search-container");
  const topBar = document.querySelector(".top-bar");
  const navBar = document.querySelector(".navbar");
  const navbarToggle = document.getElementById("navbar-toggle");
  const loadingScreen = document.querySelector(".loading-screen");
  const homeSearch = document.getElementById("searchInput");
  const urlBar = document.getElementById("searchInputt");
  const lockIcon = document.getElementById("lockIcon");
  const backIcon = document.getElementById("backIcon");
  const forwardIcon = document.getElementById("forwardIcon");
  const refreshIcon = document.getElementById("refreshIcon");
  const fullscreenIcon = document.getElementById("fullscreenIcon");
  const movies = document.getElementById("movies");
  const pages = [];
  let currentPage = -1;

  iframe.style.display = "none";

  function addToHistory(url) {
    if (url === pages[currentPage]) return;
    pages.splice(currentPage + 1);
    pages.push(url);
    currentPage = pages.length - 1;
    updateNavButtons();
  }

  function updateNavButtons() {
    backIcon.classList.toggle("disabled", currentPage <= 0);
    forwardIcon.classList.toggle("disabled", currentPage >= pages.length - 1);
  }

  function showUrl(url) {
    urlBar.value = url;
    if (url.startsWith("https://")) {
      lockIcon.className = "fa-solid fa-lock";
      lockIcon.style.color = "white";
    } else {
      lockIcon.className = "fa-solid fa-lock-open";
      lockIcon.style.color = "red";
    }
  }

  function updateNavBar() {
    const showIt = iframe.style.display === "block" && navbarToggle.checked;
    navBar.style.display = showIt ? "block" : "none";
  }

  function playAnimation(element, className, time) {
    element.classList.add(className);
    setTimeout(() => element.classList.remove(className), time);
  }

  function toUrl(query) {
    try {
      return new URL(query).href;
    } catch {}
    try {
      const url = new URL(`https://${query}`);
      if (url.hostname.includes(".")) return url.href;
    } catch {}
    return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
  }

  function showLoadingScreen() {
    loadingScreen.style.display = "flex";
    setTimeout(() => {
      loadingScreen.style.transition = "opacity 0.5s ease";
      loadingScreen.style.opacity = 1;
    }, 10);
    loadingScreen.querySelector(".loading-text").textContent = "We're getting your content ready, please wait...";
    showToast('Consider joining our <a href="https://discord.gg/y2X5RtTSe" target="_blank" class="hover-link">Discord</a>&nbsp;<3', "success", "heart");
  }

  function hideLoadingScreen() {
    loadingScreen.style.transition = "opacity 0.5s ease";
    loadingScreen.style.opacity = 0;
    setTimeout(() => {
      loadingScreen.style.display = "none";
    }, 500);
  }

  function hideRealAddress() {
    const subjects = ["math", "science", "history", "art", "programming", "philosophy"];
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    history.replaceState({}, "", "/learning?subject=" + subject);
  }

  function finishLoading() {
    hideLoadingScreen();
    updateNavBar();
    hideRealAddress();
  }

  function handleSearch(query) {
    const url = toUrl(query);
    showUrl(url);
    showLoadingScreen();
    if (searchContainer) searchContainer.style.display = "none";
    if (topBar) topBar.style.display = "none";
    iframe.style.display = "block";
    pages.length = 0;
    currentPage = -1;
    updateNavButtons();
    loadPage(url);
    setTimeout(finishLoading, 10000);
  }

  window.handleSearch = handleSearch;

  proxyFrame.addEventListener("urlchange", (event) => {
    addToHistory(event.url);
    showUrl(event.url);
  });

  iframe.addEventListener("load", finishLoading);

  backIcon.addEventListener("click", (event) => {
    event.preventDefault();
    playAnimation(backIcon, "button-animate-back", 200);
    if (currentPage > 0) {
      currentPage--;
      updateNavButtons();
      loadPage(pages[currentPage]);
    }
  });

  forwardIcon.addEventListener("click", (event) => {
    event.preventDefault();
    playAnimation(forwardIcon, "button-animate-forward", 200);
    if (currentPage < pages.length - 1) {
      currentPage++;
      updateNavButtons();
      loadPage(pages[currentPage]);
    }
  });

  refreshIcon.addEventListener("click", (event) => {
    event.preventDefault();
    playAnimation(refreshIcon, "spin", 300);
    proxyFrame.reload();
  });

  fullscreenIcon.addEventListener("click", (event) => {
    event.preventDefault();
    iframe.requestFullscreen();
  });

  [homeSearch, urlBar].forEach((input) => {
    if (!input) return;
    input.addEventListener("keyup", (event) => {
      if (event.key === "Enter") handleSearch(input.value);
    });
  });

  if (movies) {
    movies.addEventListener("click", (event) => {
      event.preventDefault();
      handleSearch("https://yaanscoat.github.io/blackwaves-movies/");
    });
  }

  navbarToggle.addEventListener("change", updateNavBar);
  window.addEventListener("load", hideLoadingScreen);
});
