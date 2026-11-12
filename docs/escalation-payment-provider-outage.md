# Escalation: checkout and card updates failing, payment provider not responding

> **This is a simulated escalation, not a real one.** It is written from the
> Third-Party Payment Provider Outage scenario in
> [TechOps Command Center](../README.md), an incident-response simulator I
> built. Meridian Cloud, Paycrest, the customers and their tickets are
> fictional. All times are the simulator's clock, from one run of the scenario
> at normal (1x) speed.

| | |
| --- | --- |
| From | Tier 2 Support |
| To | Commerce Engineering (owners of Payment Service) |
| Tickets | TKT-4820, TKT-4821 |
| Related incident | INC-1042, SEV-3 |
| Escalated | 14:03:57 UTC |
| Priority | High: customers cannot pay or update a card |

## Summary

Every payment request is failing. Payment Service is waiting on our payment
provider, Paycrest, which is timing out or returning 503. Our own systems look
healthy, and nothing has been deployed to Payment Service in 9 days. Two
customers have written in so far.

## What I need from Engineering

1. **Fail over new charges to the secondary payment provider**, if that's
   available to us, until Paycrest recovers.
2. **Confirm that queued retries won't double-charge anyone.** The logs say
   each retry keeps its idempotency key, but I need that confirmed before I
   tell a customer they weren't charged twice.
3. **Confirm receipts will send** once the queued charges go through.
4. **A status or ETA I can pass on**, even if it's "no ETA yet, next update
   in 30 minutes."

## Customer impact

- Customers can't complete a purchase or update the card on their account.
  Payments spin for about 30 seconds and then fail.
- Everything outside of payments is working. Sign-in, projects, users and
  media are all above 99% success.
- **TKT-4820, Kestrel Analytics (High):** a payment failed and they want to
  know whether they were charged twice. No receipt email yet.
- **TKT-4821, Braid Financial (Normal):** card update fails every time. They
  confirmed the rest of the app works.

## How to reproduce

No customer account is needed. Every `POST /api/payments` is failing right
now. From the API monitor at 14:03:34:

| Endpoint | Success | Median latency |
| --- | --- | --- |
| `POST /api/payments` | **0.00%** | **29.5 s** |
| `POST /api/login` | 99.73% | 37.8 ms |
| `GET /api/projects` | 99.36% | 79.4 ms |
| `GET /api/media` | 99.64% | 153 ms |

Expected: a charge completes in a few seconds. Actual: the request hangs
until our 30-second timeout and fails.

## Evidence

**Payment Service logs (14:03:11 to 14:03:13):**

```
ERROR  provider request timed out after 30000ms
       POST https://api.paycrest.example/v2/charges
ERROR  provider returned 503 Service Unavailable (retry-after: 120)
WARN   circuit breaker half-open for provider paycrest; probe failed, re-opening
INFO   charge 4303 queued for retry; idempotency key retained
```

**Downstream effects:**

```
WARN   message-queue        payment-retry queue depth 1441, consumers blocked on upstream provider
WARN   notification-worker  receipt email deferred, awaiting charge confirmation
```

**Service health at 14:03:32:**

- Payment Service: 82% errors, 29.5 s latency. That latency is our timeout,
  which means the provider isn't answering at all.
- Notification Worker: 14% errors, because receipts are waiting on charges.
- API Gateway: 5% errors. Payments are a small share of its traffic.

**Alerts:** Payment Service latency at 14:02:40, then error rate at 14:02:42.
INC-1042 was declared at 14:02:55. The first ticket came in at 14:03:09.

## What I've ruled out

1. **A bad deploy on our side.** Payment Service last deployed 9 days ago
   (2.7.8). The two most recent deploys were Media Service (3 hours ago) and
   Customer API (7 hours ago), and both services are healthy.
2. **Database or cache.** Primary Database is at 11.0 ms and 0.10% errors, and
   Redis at 1.29 ms and 0.03%.
3. **Our internal network or DNS.** The DNS Resolver is healthy at 0.02%
   errors, an internal health check returned HTTP 200, and the sign-in,
   projects, users and media endpoints are all above 99% success.
4. **A platform-wide problem.** Only payment flows are failing. The one thing
   Payment Service does that nothing else does is call Paycrest, and those are
   the calls timing out.

## What I'm telling customers

Holding reply for both tickets:

> We're seeing a problem with our payment provider that's stopping payments
> and card updates from going through. The rest of your account isn't
> affected. Payments that failed are being held to retry, and we're confirming
> now that no one will be charged twice. I'll update you within 30 minutes, or
> sooner if it's fixed.

I won't confirm "you weren't charged twice" until Engineering confirms item 2
above.

## Next update

I'll update both tickets in 30 minutes, or as soon as I hear back on the
failover.

---

## What happened next

- **14:03:58:** Engineering started the failover to the secondary provider.
- **14:04:53:** Payments recovered and the incident was resolved.
- Per the incident record, queued charges were replayed against the secondary
  provider with their original idempotency keys, so no one was charged twice,
  and the deferred receipts went out.
- With that confirmed, I could update both tickets: payments are working, no
  double charges, and the receipt is on its way.
- Follow-up from the incident: shorten the provider timeout from 30 seconds to
  8, so a failure shows the customer a clear error instead of a long spinner.
