// Apply the saved theme before the first paint without an inline script.
try {
  if (localStorage.getItem("ow-theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
} catch (e) {}
