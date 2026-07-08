# Service Level Expectations

*What you can reasonably expect of the service. This is an expectations statement for the self-serve tiers, not a contractual SLA; enterprise SLAs are available by agreement.*

## Availability
We aim for high availability of the application and of published customer sites. Published sites are static and hosted on a resilient CDN (Netlify), so your live website's availability does not depend on the application being online. **[[OWNER: state a target (e.g. 99.9% monthly) if you wish to commit to one; the self-serve tier is provided without a contractual uptime guarantee unless stated.]]**

## Publishing & durability
- Publishing is atomic; a failed publish leaves your live site unchanged.
- Every published version is retained and restorable.
- Backups (point-in-time recovery) protect stored data; the export right is an independent backstop.

## Support
- **Self-serve tiers:** support via **[[OWNER: email/help channel]]**, best-effort response within **[[OWNER: e.g. 2 business days]]**.
- **Managed / Agency / Enterprise:** enhanced support per your agreement.

## Maintenance
Planned maintenance is scheduled to minimize disruption; the application may be briefly unavailable while published sites remain up.

## Incident response
We monitor health, log every operational event durably, and alert operators on failures. Security incidents are handled per the [Security Statement](SECURITY-STATEMENT.md) and the [DPA](DPA.md) breach-notification terms.

## Enterprise SLA
A contractual SLA (uptime credits, response times, escalation) is available for Enterprise customers by agreement. **[[OWNER: attach the enterprise SLA terms if offered.]]**
