# Control room rules

Pure functions, tested without a browser:

- `age.ts`: the live age of the data (data time against the browser clock), its band against the
  source's limits and its place on the age line.
- `severity.ts`: states ordered from the one that needs a person first to the one that needs
  nobody, the sort of sources by that order and the count per state.
- `states.ts`: each state's icon and the colour an age takes (neutral outside the service period).
