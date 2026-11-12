# Recorder sources

`moviq-recorder-stats` reads the statistics that MovIQ's own recorder on Cloudflare
(`apps/recorder-cf`) publishes for each New York day: segment run times, headways, prediction
errors, stoppages and incident durations, each with its count (`recorderStatsSchema` in the
contracts). It needs the integration `moviq-recorder` (`RECORDER_URL`, `RECORDER_READ_TOKEN`);
without it the source is `misconfigured`.

Tested in `apps/server/tests/recorder/recorder-stats-source.test.ts`.
