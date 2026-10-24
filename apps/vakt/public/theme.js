// Sets light or dark on <html> before the first paint (a file of its own: the page's security policy allows no inline
// scripts). 'auto', or nothing chosen, follows the phone. src/lib/theme.ts keeps it up to date while the app runs.
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('vakt-theme') || 'auto'; } catch (e) {}
  var dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
