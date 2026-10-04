# Sign-in setup (Supabase), once

1. Create a free project at https://supabase.com
2. Authentication -> Providers -> turn on **Google** (paste a Google OAuth client id and secret) and **Email**.
3. Authentication -> URL Configuration -> Redirect URLs: add `http://127.0.0.1:53682/callback`
4. Project Settings -> API: copy **Project URL** and the **anon public** key into `supabase.json` here:

    { "url": "https://abcdxyz.supabase.co", "anonKey": "eyJ..." }

The anon key is meant to be public (it is shipped inside every app). Do not use the service_role key.
You can also skip the file: Paru shows a "Connect sign-in" form the first time it starts.
