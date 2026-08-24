/** Inline theme bootstrap + native click handler for [data-theme-toggle]. */
export const THEME_INIT_SCRIPT = `
(function(){
  var KEY = 'upcut-theme';
  var DARK = {
    '--bg':'#09090b','--background':'#09090b','--color-background':'#09090b',
    '--foreground':'#fafafa','--color-foreground':'#fafafa',
    '--surface':'#18181b','--card':'#18181b','--color-card':'#18181b',
    '--card-foreground':'#fafafa','--color-card-foreground':'#fafafa',
    '--popover':'#1c1c1f','--color-popover':'#1c1c1f',
    '--popover-foreground':'#fafafa','--muted':'#27272a','--color-muted':'#27272a',
    '--muted-foreground':'#a1a1aa','--color-muted-foreground':'#a1a1aa',
    '--secondary':'#27272a','--color-secondary':'#27272a',
    '--secondary-foreground':'#fafafa','--accent':'#27272a','--color-accent':'#27272a',
    '--accent-foreground':'#fafafa','--border':'#27272a','--color-border':'#27272a',
    '--input':'#3f3f46','--color-input':'#3f3f46',
    '--sidebar':'#0c0c0e','--color-sidebar':'#0c0c0e',
    '--sidebar-foreground':'#fafafa','--color-sidebar-foreground':'#fafafa',
    '--sidebar-accent':'#27272a','--color-sidebar-accent':'#27272a',
    '--sidebar-border':'#27272a','--color-sidebar-border':'#27272a',
    '--surface-alt':'#27272a','--surface-elevated':'#1c1c1f','--surface-hover':'#27272a',
    '--border-alt':'#3f3f46'
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
