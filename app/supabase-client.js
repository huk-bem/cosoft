// ============================================================================
// CoSoft – Supabase-Client + Auth-Hilfsfunktionen (von auth.html & dashboard.html genutzt)
// ============================================================================

const CONFIG_MISSING =
  !window.COSOFT_CONFIG ||
  window.COSOFT_CONFIG.SUPABASE_URL.includes('DEIN-PROJEKT') ||
  window.COSOFT_CONFIG.SUPABASE_ANON_KEY.includes('DEIN-ANON-KEY');

if (CONFIG_MISSING) {
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.className = 'config-warning';
    banner.innerHTML =
      '⚠️ Supabase ist noch nicht konfiguriert. Bitte <code>app/config.js</code> mit deiner ' +
      'Projekt-URL und dem anon Key ausfüllen (siehe README.md).';
    document.body.prepend(banner);
  });
}

const supabaseClient = CONFIG_MISSING
  ? null
  : window.supabase.createClient(window.COSOFT_CONFIG.SUPABASE_URL, window.COSOFT_CONFIG.SUPABASE_ANON_KEY);

/** Leitet auf die Login-Seite um, wenn kein aktiver Login besteht. Gibt die Session zurück. */
async function requireAuth() {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = 'auth.html';
    return null;
  }
  return data.session;
}

async function logout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  window.location.href = 'auth.html';
}
