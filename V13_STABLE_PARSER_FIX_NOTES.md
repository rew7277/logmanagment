# ObserveX V13 — Stable Parser Fix

## What was fixed

1. **Mule service/API detection is now strict**
   - API/service is extracted only from Mule runtime app names like `[s-gupshup-api]`.
   - FlowStack references like `@ s-gupshup-api:generate-otp.xml:36` resolve to `s-gupshup-api`.
   - `*.xml`, subflows and processors are ignored as service names.

2. **Endpoint extraction remains separate**
   - `.get:\generate-otp` becomes `GET /generate-otp`.
   - `.get:\verify-otp` becomes `GET /verify-otp`.
   - `.post:\crif\sms` becomes `POST /crif/sms`.

3. **Log Search default time filter changed to All time**
   - Uploaded historic or future-dated logs are visible immediately.
   - Users can still filter by last 1h/24h/7d/30d.

4. **Analytics excludes implementation files**
   - Services and endpoint analytics ignore `*.xml` service records.
   - Overview service/endpoint counts exclude bad legacy XML-service rows.

5. **Bulk ingestion has final sanitation before DB insert**
   - Even if a parser sends a bad `service_name`, the repository layer repairs or nulls it before insert.

## Important deployment note

If a previous build inserted bad rows such as `generate-otp.xml` as a service, clear the environment once:

Overview → Delete uploaded logs → Re-upload the log file.

After re-upload, APIs / Services should show only:

- `s-gupshup-api`

Endpoints should show:

- `GET /generate-otp`
- `GET /verify-otp`
- `POST /crif/sms`
