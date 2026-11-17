/* Karki AI - turns the site into an installable app (PWA). */
(function () {
  var head = document.head;
  function add(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    head.appendChild(el);
  }
  if (!document.querySelector('link[rel="manifest"]')) add("link", { rel: "manifest", href: "/manifest.json" });
  add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
  add("meta", { name: "mobile-web-app-capable", content: "yes" });
  add("meta", { name: "apple-mobile-web-app-title", content: "Karki AI" });
  add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
  add("link", { rel: "apple-touch-icon", href: "/icons/icon-192.png" });
  add("link", { rel: "icon", type: "image/png", href: "/icons/icon-192.png" });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();
