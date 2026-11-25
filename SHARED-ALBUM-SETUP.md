# Shared Christmas album setup

The existing **回忆相册** stays local to each browser. The added **共享相册** button uses a private Supabase project so explicitly allowlisted members can upload photos and see updates from other members.

## 1. Create the private album backend

Open the Supabase SQL Editor and run [`supabase/shared-album.sql`](supabase/shared-album.sql). It creates the private `christmas-album` bucket, limits files to 8 MB and common image formats, creates the photo table, and applies access rules. Only email addresses in `christmas_album_members` can view or upload; each member can delete only their own photos.

## 2. Configure invite-only sign-in

In Authentication settings, turn off **Allow new users to sign up** and keep email confirmation enabled. Set the Supabase Site URL and allowed redirect URL to:

`https://lovegem777-afk.github.io/christmas-tree/`

Create each invited account through Authentication → Users, then add the same email to the member allowlist in SQL Editor:

```sql
insert into public.christmas_album_members (email)
values (lower('person@example.com'))
on conflict (email) do nothing;
```

Repeat for your own account and each person you want to invite. Enter their real addresses only in Supabase; never commit them to the public website repository.

**Email delivery note:** Supabase's built-in email sender is limited to project organization members and currently allows 2 emails per hour. To send sign-in links or invitations to other people, configure a custom SMTP provider first. Do not add invitees as Supabase organization members just to work around this limit; that would give them project-level access. See [Supabase's SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

## 4. Add the browser-safe project settings

In Supabase project settings, copy the Project URL and **publishable** key into `shared-album-config.js`:

```js
window.CHRISTMAS_ALBUM_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  publishableKey: "YOUR-PUBLISHABLE-KEY",
  albumId: "christmas-tree-shared",
};
```

The publishable key is designed for browser use; table and storage policies enforce the member allowlist. Never put a `service_role` or secret key in this file.

## 5. Publish the website changes

Commit `index.html`, `shared-album.js`, `shared-album-config.js`, `supabase/shared-album.sql`, and this setup guide to the `main` branch of `lovegem777-afk/christmas-tree`. GitHub Pages will publish the new **共享相册** button. The existing local album and tree remain in place.

## How sharing works

An allowlisted member signs in, uploads a photo, and the file is stored in the private bucket. The table stores its album ID, path, uploader, and time. Other members subscribe to table changes and refresh their gallery automatically. Existing photos saved in a person's browser are not uploaded automatically. Any member who can view a photo can also save a copy, so share only photos you're comfortable sharing with the invited group.

