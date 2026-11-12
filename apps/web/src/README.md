# Web sources

`main.tsx` applies the saved theme and language and mounts the app. `app/` decides which feature
an address opens, `features/` holds one folder per product feature and `shared/` the pieces every
feature uses. Features may import from `shared/`; `shared/` never imports from a feature.
