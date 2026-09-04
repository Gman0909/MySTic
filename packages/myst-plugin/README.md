# `@mystic/myst-plugin`

A [mystmd](https://mystmd.org) plugin that pulls a section from any MyST site
indexed by a [MySTic](../../README.md) instance into **your own** MyST site, at
build time.

This is the outward-facing half of MySTic: instead of sending readers to a
MySTic collection, you keep your own site and theme, and drop in the pieces you
want from elsewhere.

## Install

Copy `mystic.mjs` next to your project and register it in `myst.yml`:

```yaml
project:
  plugins:
    - mystic.mjs
```

Requires mystmd ≥ 1.10 (the plugin uses the `directives` + `transforms` plugin
API and document-stage async transforms).

## Use

Point the directive at the source page, and name the MySTic instance that has
that site indexed:

```markdown
:::{mystic} https://foundations.projectpythia.org/core.xarray.xarray-intro#introducing-xarray
:api: https://mystic.example
:::
```

With no `#anchor`, the whole page is embedded; with one, only that section (the
heading and everything under it, up to the next heading of the same level).

You can also point at an item in a MySTic collection you have already curated,
in which case `:api:` is optional — it defaults to the link's own origin:

```markdown
:::{mystic} https://mystic.example/c/intro-to-xarray/2f0c…
:::
```

### Options

| Option | Effect |
| --- | --- |
| `:api:` | Base URL of the MySTic instance. Required unless the argument is already a MySTic URL. |
| `:no-attribution:` | Suppress the attribution line. Most upstream content is licensed *on the condition* that it is attributed — only use this if you credit the source another way. |

## What it emits

The embedded AST, followed by an attribution line:

> *Embedded from [Pythia Foundations](https://foundations.projectpythia.org) · Project Pythia · CC-BY-4.0 · via MySTic*

Style it with the `.mystic-attribution` class.

## Failure behaviour

Content is fetched during the build. If the instance is unreachable or the URL
does not resolve to an indexed site, the build **does not fail**: the plugin
emits a warning on the file and leaves a visible placeholder in its place.

Because resolution happens at build time, the embedding site stays static — but
it also means the copy is only as fresh as your last build. Rebuild to pick up
upstream edits.
