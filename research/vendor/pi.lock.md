# research/vendor/pi — pinned, not committed

`research/vendor/pi/` is a 41 MB shallow clone, so it is git-ignored. Recreate it with:

```sh
git clone https://github.com/earendil-works/pi research/vendor/pi
git -C research/vendor/pi checkout e792ba131ed0495f3ff58a0eb13f20540e344d5c
```

`earendil-works/pi` is what the user called "earendil/pi-mono"; the org was renamed. Every `research/vendor/pi/...`
path cited in `research/domain/` refers to this commit.
