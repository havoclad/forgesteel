# Forge Steel Server

See ../readme.md for launching forgesteel.  These instructions are for
standing up the group server.

**FORGE STEEL** is a hero builder app for **DRAW STEEL**, designed by [Andy Aiken](mailto:andy.aiken@live.co.uk).

You can find it [here](https://andyaiken.github.io/forgesteel/).

## Legal

**FORGE STEEL** is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC.

**DRAW STEEL** © 2024 MCDM Productions, LLC.

## Development

**FORGE STEEL** is written in Typescript, using React and Ant Design.

If you would like to contribute, you can:

* Add feature requests and raise bug reports [here](https://github.com/andyaiken/forgesteel/issues)
* Fork the repository, make your changes to the code, and raise a pull request


## Server

To run the server locally, run the following commands:

```
npm install
```

Once built, the app should then be available at `http://localhost:3001`

Configure Discord Developer Portal
Oauth2 ->  Redirects -> Add: http//localhost:5173/forgesteel/auth/callback
Copy your ClientID to  server/.env (start from server/.env.example)
Copy your Client Secret to server/.env

```
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_REDIRECT=http://localhost:5173/forgesteel/auth/callback
JWT_SECRET=$(openssl rand -base64 32)
``

Then ```
npm run dev
```

In forgesteel go to Settings -> Admin -> Room Server and put in the URL

The server will show 'Auth: Discord Oauth enabled' when configured
correctly. Without the `.env` file, it falls back to legacy UUID-based
authentication for local development.
