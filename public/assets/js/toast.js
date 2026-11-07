function showToast(message, type = "success", icon = "check-circle") {
  const toast = document.createElement("div");
  toast.className = `toast show ${type}`;
  toast.innerHTML = `<i class="fa-solid fa-${icon}" style="margin-right: 8px;"></i>${message} `;

  const closeButton = document.createElement("button");
  closeButton.className = "toast-close";
  closeButton.innerHTML = '<i class="fa-solid fa-xmark" style="margin-left: 8px; font-size: 0.8em;"></i>';
  toast.appendChild(closeButton);
  document.body.appendChild(toast);

  function hideToast() {
    toast.classList.remove("show");
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 500);
  }

  closeButton.addEventListener("click", hideToast);
  setTimeout(hideToast, 3000);
}
