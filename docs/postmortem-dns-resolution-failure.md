# Postmortem: INC-1042, DNS Resolution Failure

> **This is a simulated incident, not a real outage.** It is a postmortem of the
> DNS Resolution Failure scenario in [TechOps Command Center](../README.md), an
> incident-response simulator I built. Meridian Cloud, its services, staff and
> customers are fictional. No real systems or people were affected. All times
> are the simulator's clock, from one run of the scenario at normal (1x) speed.

| | |
| --- | --- |
| Incident | INC-1042 |
| Severity | SEV-1 |
| Duration | 1m 54s (14:02:03 to 14:03:57 UTC) |
| Services affected | 8 of 15 |
| Root cause | Bad zone-file deploy to the internal DNS resolvers |

## Summary

Internal name resolution failed across production. The internal resolvers
started answering SERVFAIL for every `internal.meridian.example` hostname, so
services could no longer find each other even though every host was up.
Customer-facing traffic failed across the dashboard, sign-in, checkout and
media. The data tier stayed healthy throughout.

I confirmed the cause 55 seconds in by comparing a DNS lookup with a ping by
IP address. Rolling the zone back and flushing the resolver caches restored
service, and the incident was resolved at 1m 54s.

## Impact

- **Customers:** could not load the dashboard, sign in, or complete checkout.
  Media requests failed too. Cached pages kept serving for a short time.
- **Services:** 8 of 15 affected. Peak error rates when their alerts fired:

  | Service | Error rate |
  | --- | --- |
  | DNS Resolver | 92.0% |
  | API Gateway | 44.0% |
  | Identity Service | 37.5% |
  | Web Frontend | 33.8% |
  | Media Service | 32.4% |
  | Customer API | 31.4% |
  | Payment Service | 29.4% |

- **Edge CDN** was the least affected. It could not resolve the origin, so it
  served stale objects from cache, with errors around 0.2%.
- **Not affected:** Primary Database, Redis Cache, Message Queue, Internal API,
  Notification Worker and Analytics Pipeline.

## Timeline (UTC, simulated)

| Time | Elapsed | Event |
| --- | --- | --- |
| 14:02:03 | 0:00 | Anomaly detected in production telemetry. |
| 14:02:06 | 0:03 | Overview shows Degraded Performance. |
| 14:02:18 | 0:15 | Overview shows Major Incident. |
| 14:02:23 | 0:20 | First alert: DNS Resolver error rate at 92% (threshold 0.4%). |
| 14:02:23 | 0:20 | I start investigating: overview, alerts, support queue. |
| 14:02:27 | 0:24 | Infrastructure: DNS Resolver and 4 application services critical, data tier green. |
| 14:02:30 | 0:27 | Service catalogue: checked error rates and last deploy for every service. |
| 14:02:31 | 0:28 | Logs: gateway and identity errors are lookup failures, not query errors. |
| 14:02:36 | 0:33 | Alerts fire for DNS Resolver latency and API Gateway error rate. |
| 14:02:36 | 0:33 | Network: resolver 10.20.0.53 is CRITICAL in `status`. |
| 14:02:39 | 0:36 | `dig api.internal` returns SERVFAIL. |
| 14:02:46 | 0:43 | `ping api.internal` fails: unknown host. |
| 14:02:48 | 0:45 | SEV-1 declared by auto-detection. |
| 14:02:50 | 0:47 | `ping 10.20.12.44` (same host, by IP) succeeds, 0% loss. |
| 14:02:54 | 0:51 | `traceroute 10.20.12.44` completes in 4 clean hops. |
| 14:02:57 | 0:54 | `curl https://api.internal/health` fails: could not resolve host. |
| 14:02:58 | 0:55 | Diagnosis submitted and confirmed: DNS resolution failure. |
| 14:02:58 | 0:55 | Started rollback of the `internal.meridian.example` zone to last known-good. |
| 14:03:10 | 1:07 | Zone rollback complete. Started flushing resolver caches. |
| 14:03:57 | 1:54 | All services healthy. Incident resolved. |

## What I checked and ruled out

1. **Database or data tier.** Ruled out. Primary Database was at 13.1 ms and
   0.12% errors, Redis at 1.22 ms and 0.02%, Message Queue at 0.07%. A
   saturated database would show high latency and connection pressure, and
   these were normal.
2. **Network path or packet loss.** Ruled out. A ping to the API gateway by IP
   (`10.20.12.44`) returned 5 of 5 packets at about 24 ms, and traceroute
   reached it in 4 hops. Packets were flowing. The failure happened before a
   connection was ever made.
3. **A bad code deploy.** Ruled out. The most recent deploys were Media Service
   (3 hours earlier) and Customer API (7 hours earlier). Services that had not
   deployed for a day or more, like API Gateway, Web Frontend and Payment Service, were
   failing in the same way at the same time. A code regression usually stays
   inside one service.
4. **Identity service outage.** Ruled out as the cause. Identity was failing,
   but so were services that never call it.
5. **CDN outage.** Ruled out. The CDN was the healthiest of the affected
   services because it was serving from cache.

What pointed to DNS:

- The gateway logs said `lookup customer-api.internal.meridian.example on
  10.20.0.53:53: server misbehaving`, and Identity said `failed to resolve
  pg-primary-01.internal.meridian.example: no such host`. These are lookup failures,
  not timeouts or query errors.
- `dig api.internal` returned `status: SERVFAIL` with no answer, from server
  `10.20.0.53`.
- `ping api.internal` failed with an unknown host, while `ping 10.20.12.44`
  reached the same machine with no loss. The host was up and nothing could look
  up where it was.

## Root cause

A zone-file deployment to the internal resolvers removed the A records for
`internal.meridian.example`. The resolvers loaded the bad zone and began answering
SERVFAIL for every internal hostname. Every service-to-service call failed at
name resolution, before any traffic was sent. Because nearly every service
looks up a hostname before it calls another one, the failure spread across the
platform within seconds.

## Fix

1. Rolled the `internal.meridian.example` zone back to the last known-good version
   (12 seconds).
2. Flushed the negative caches on all resolvers. Rolling back alone was not
   enough, because clients had cached the failed answers and would have kept
   failing until those expired.

Name resolution recovered right away. Dependent services cleared their retry
backlogs and every service was healthy at 14:03:57.

Restarting the API Gateway or Web Frontend would not have helped. Both would
have come back up and failed the same lookups.

## Prevention

| # | Action | Why |
| --- | --- | --- |
| 1 | Validate zone files in the deploy pipeline and block the deploy if the record count drops sharply. | This change removed every A record, which a pre-deploy check would catch. |
| 2 | Roll out zone changes to one resolver first, and roll back automatically if its SERVFAIL rate rises. | Limits the blast radius of the next bad zone to one resolver. |
| 3 | Add a synthetic check that resolves key internal hostnames every 30 seconds. | Catches resolution failures directly, not through the services that depend on them. |
| 4 | Add flushing resolver caches to the DNS rollback runbook. | The rollback alone does not restore service while failed answers are cached. |
| 5 | Add a triage step to the runbook: when many services fail at once and the data tier is healthy, compare `dig` with a ping by IP first. | That one comparison separates a DNS failure from a network or host failure in seconds. |
