window.onload = function () {
  const storedName = localStorage.getItem("userName");
  const nameInput = document.getElementById("userName");
  const doneButton = document.getElementById("doneButton");

  if (!storedName) {
    document.getElementById("overlay").style.display = "block";
    document.getElementById("namePrompt").style.display = "block";
  } else {
    updateGreeting(storedName);
  }

  doneButton.disabled = nameInput.value.trim() === "";
  nameInput.addEventListener("input", function () {
    doneButton.disabled = nameInput.value.trim() === "";
  });
};

function submitName() {
  const name = document.getElementById("userName").value.trim();
  if (!name) return;

  localStorage.setItem("userName", name);
  updateGreeting(name);
  document.getElementById("namePrompt").classList.add("fade-out");
  showToast(`Hey, ${name}! Welcome to BlackWaves!`, "success", "smile");

  setTimeout(function () {
    document.getElementById("namePrompt").style.display = "none";
    document.getElementById("overlay").style.display = "none";
  }, 300);
}

function updateGreeting(name) {
  const greetingElement = document.getElementById("greeting");
  if (!greetingElement) return;

  const greeting = getGreeting();
  greetingElement.innerHTML = `<i class="${greeting.iconClass}"></i> ${greeting.text}, ${name}!`;
  greetingElement.style.opacity = 1;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return { text: "Good morning", iconClass: "fas fa-cloud-sun" };
  } else if (hour >= 12 && hour < 17) {
    return { text: "Good afternoon", iconClass: "fas fa-sun" };
  } else if (hour >= 17 && hour < 21) {
    return { text: "Good evening", iconClass: "fas fa-cloud-moon" };
  } else {
    return { text: "Good night", iconClass: "fas fa-moon" };
  }
}
