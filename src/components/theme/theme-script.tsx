/** Inline theme bootstrap + native click handler for [data-theme-toggle]. */
export const THEME_INIT_SCRIPT = `
(function(){
  var KEY = 'upcut-theme';
  var DARK = {
    '--bg':'#100e0e','--background':'#100e0e','--color-background':'#100e0e',
    '--foreground':'#fdfff0','--color-foreground':'#fdfff0',
    '--surface':'#181616','--card':'#181616','--color-card':'#181616',
    '--card-foreground':'#fdfff0','--color-card-foreground':'#fdfff0',
    '--popover':'#181616','--color-popover':'#181616',
    '--popover-foreground':'#fdfff0','--muted':'#1c1a1a','--color-muted':'#1c1a1a',
    '--muted-foreground':'rgba(253, 255, 240, 0.5)','--color-muted-foreground':'rgba(253, 255, 240, 0.5)',
    '--secondary':'#1c1a1a','--color-secondary':'#1c1a1a',
    '--secondary-foreground':'#fdfff0','--accent':'#1c1a1a','--color-accent':'#1c1a1a',
    '--accent-foreground':'#fdfff0','--border':'#212121','--color-border':'#212121',
    '--input':'#2a2a2a','--color-input':'#2a2a2a',
    '--primary':'#fdfff0','--color-primary':'#fdfff0',
    '--primary-foreground':'#100e0e','--color-primary-foreground':'#100e0e',
    '--vyrll-accent':'#fdfff0','--ring':'#fdfff0','--color-ring':'#fdfff0',
    '--sidebar':'#100e0e','--color-sidebar':'#100e0e',
    '--sidebar-foreground':'#fdfff0','--color-sidebar-foreground':'#fdfff0',
    '--sidebar-primary':'#fdfff0','--sidebar-primary-foreground':'#100e0e',
    '--sidebar-accent':'#1c1a1a','--color-sidebar-accent':'#1c1a1a',
    '--sidebar-border':'#212121','--color-sidebar-border':'#212121',
    '--surface-alt':'#1c1a1a','--surface-elevated':'#181616','--surface-hover':'#1c1a1a',
    '--border-alt':'#2a2a2a'
  };
  function forcedLight(path){
    return path === '/' || path === '/login' || path === '/register' || path === '/forgot-password' || path === '/reset-password';
  }
  function apply(theme){
    var root = document.documentElement;
    root.classList.remove('light','dark');
    root.classList.add(theme);
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    var keys = Object.keys(DARK);
    if (theme === 'dark') {
      for (var i = 0; i < keys.length; i++) root.style.setProperty(keys[i], DARK[keys[i]]);
    } else {
      for (var j = 0; j < keys.length; j++) root.style.removeProperty(keys[j]);
    }
    // Never set inline styles on <body> — React hydrates it and will warn/mismatch.
    if (document.body && document.body.style) {
      document.body.style.removeProperty('background-color');
      document.body.style.removeProperty('color');
    }
  }
  function resolve(){
    if (forcedLight(location.pathname)) return 'light';
    try {
      var s = localStorage.getItem(KEY);
      if (s === 'light' || s === 'dark') return s;
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  apply(resolve());
  document.addEventListener('click', function(e){
    var t = e.target;
    var btn = t && t.closest ? t.closest('[data-theme-toggle]') : null;
    if (!btn) return;
    if (forcedLight(location.pathname)) return;
    e.preventDefault();
    var next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (err) {}
    btn.setAttribute('aria-label', next === 'dark' ? 'Mode jour' : 'Mode nuit');
    btn.setAttribute('title', next === 'dark' ? 'Mode jour' : 'Mode nuit');
    try {
      window.dispatchEvent(new CustomEvent('upcut-theme-change', { detail: { theme: next } }));
    } catch (err2) {}
  }, true);
})();
`;
