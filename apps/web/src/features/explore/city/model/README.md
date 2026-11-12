# City layers model

- `layers.ts`: the groups and their order, all layers off at first, which layers are asked for a
  box (dense layers wait for a zoom), what is drawn and what is listed, the time an item is
  listed by (a permit in force since another day, until it ends; today's by their start, then
  those by their end) and the tone of its mark.
- `panel.ts`: the layers of a group, the age of a layer by its sources, the note under a
  layer that is on (too far out, not answered yet, too many, a list, nothing in the box) and how
  many layers of a group are on.
