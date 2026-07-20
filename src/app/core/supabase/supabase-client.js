/*
  Cliente de Supabase compartido por toda la aplicación.

  CONFIGURACIÓN REQUERIDA:
  Reemplaza los valores de SUPABASE_URL y SUPABASE_ANON_KEY con los de tu
  proyecto (Supabase → Project Settings → API). Es seguro que estos dos
  valores vivan en el código público del repo: son la URL y la "anon key",
  pensadas para exponerse en el navegador. La seguridad real depende de la
  configuración de Auth en el panel de Supabase, no de ocultar esta clave.

  NUNCA pongas aquí la "service_role key" (esa es secreta y no se usa en
  el navegador).

  Debe cargarse antes que auth.service.js y navbar.js.
*/
const SUPABASE_URL = "https://yqkvgfqplmbbcebrivpt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxa3ZnZnFwbG1iYmNlYnJpdnB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODgxOTEsImV4cCI6MjEwMDA2NDE5MX0.wU-ylZ6agwkochwmOGe-7BROByw1qsvYpmqT5xDvF1Y";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
