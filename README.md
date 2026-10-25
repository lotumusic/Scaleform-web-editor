# Starfield Menu Editor

A browser-based visual editor for Starfield's Scaleform menus (`.swf` / `.gfx`).
Open a menu such as a quick loot mod's, click an element, and change its layout
and look. Then export a patched file to drop back into `Data/Interface/`.

Everything runs locally in the browser. Nothing is uploaded.

## Running it

It's a static page with no build step:

```sh
python3 -m http.server 8080   # or: npm start
# then open http://localhost:8080
```

You can also host the repository root on GitHub Pages.

## What you can edit

| Element    | Edits                                                                 |
|------------|-----------------------------------------------------------------------|
| Any        | Position, size, scale, rotation (drag, handles, or typed values), show/hide |
| Any        | Opacity and colour tint (written as a colour transform on the placement) |
| Text field | Starting text, colour, font size, alignment, box width/height         |
| Shape      | Solid fill, gradient stop and line colours, with per-colour opacity   |

Other features:

- Layers tree, a symbol browser, and frame/label picking for multi-frame clips.
- Double-click to enter a symbol, <kbd>Esc</kbd> to go back, arrow keys to nudge.
- Undo/redo, plus "Reset to original" for each element.
- Linked files: menus load other `.swf` files at runtime (shared widgets, button
  art, fonts). Add them with **Linked files** (or pick your whole extracted
  `Interface` folder) and the editor draws those parts too, following links
  between linked files. The inspector lists which linked files are loaded or
  missing. Linked content is shown for reference: you can move, restyle or hide
  where it's placed in your menu, but its insides belong to the other file and
  export only writes the menu you opened.
- Edits to animated elements can shift every keyframe together so the animation keeps its shape.

## Getting a menu file

1. Vanilla menus are in `Starfield - Interface.ba2`. Extract it with Bethesda
   Archive Extractor or the Creation Kit's Archive2, then look in `Interface/`.
2. Mod menus ship as loose files under `Data/Interface/…/*.swf`.
   You can open a menu together with its linked files in one go: the file that
   none of the others load is opened as the menu.
3. After exporting, put the edited file back at the same path.

## Limitations

- ActionScript isn't run. If menu code positions or styles an element at
  runtime, that overrides what you set here. Most list text is filled in by code.
- Text previews use a stand-in font. Starfield's fonts load from `fonts_*.swf` in game.
- Parts that come from linked files you haven't added show as grey,
  labelled placeholders. That includes elements placed by ActionScript class
  name, such as a widget defined in another file.
- LZMA-compressed (`ZWS`) files have to be resaved uncompressed or with zlib
  first, for example with JPEXS FFDec.
- Editing a shared symbol, shape or text field changes every place it's used.
  The inspector warns you when that applies.

## How it works

- `swf-core.js` parses SWF/GFx tags, evaluates display lists, and rewrites only
  the bytes it changes (PlaceObject matrices/colour transforms/visibility,
  DefineEditText, and shape colours). Everything else is left byte-for-byte
  unchanged. It has no DOM dependencies.
- `sample.js` builds a small QuickLoot-style menu so there's something to try.
- `index.html` is the editor UI: a canvas renderer, hit testing, and the inspector.

Run the tests with `npm test` (Node 18+).
