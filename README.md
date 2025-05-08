# SZI Explorer

Exploring reading SZI files from endpoints using ranged fetch requests.

This is a prototype to help understand reading SZI files with OpenSeaDragon. It's written in SvelteKit but really, if you understand HTML/CSS/JS, you are in a good place. `/src/routes/+page.svelte` contains most of the front-end; `src/lib/szi_reader.ts` contains the SZI parsing code.

## Requirements

Node 22+, pnpm

## Installing dependencies

```bash
pnpm install
```

## Developing

Start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## What's an SZI file?

It's a single-file variant of a Deep-Zoom Image (DZI) file - a way of turning large images into tiles, much like slippymaps. It takes the DZI directory structure, and wraps it in an **uncompressed** zip. It's very important it's uncompressed.

Then, because we can request a range of bytes in a file over HTTP, we can read those individual files in the client.

Command-line tools like [vips][vips] can create these files easily, if you specify an output format with the extension `.zip` when you tile them. For instance, using the `[sharp][sharp]` library:

```js
await largeImage.jpeg().tile({ size: tile_size }).toFile('output.zip');
```

The file can have any name - rename it to `.szi` if you like.

## Specific requirements

Right now, it's important that the place you host your `szi` file returns an accurate `content-length` header when asked for a `HEAD` request. S3 and compatible hosts do this, for instance. In future, it'd be good to be able to manually override this.
