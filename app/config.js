// ============================================================================
// CoSoft – Supabase-Konfiguration
// ============================================================================
// Trage hier die Werte aus deinem Supabase-Projekt ein:
// Dashboard -> Project Settings -> API -> "Project URL" und "anon public" Key.
//
// Wichtig: Der "anon" Key ist bewusst öffentlich/clientseitig sichtbar – das
// ist bei Supabase so vorgesehen. Die eigentliche Absicherung passiert über
// Row Level Security (siehe supabase/schema.sql), nicht über Geheimhaltung
// dieses Keys. Verwende NIEMALS den "service_role" Key hier.
// ============================================================================

window.COSOFT_CONFIG = {
  SUPABASE_URL: 'https://DEIN-PROJEKT.supabase.co',
  SUPABASE_ANON_KEY: 'DEIN-ANON-KEY',
};
