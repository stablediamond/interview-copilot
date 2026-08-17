import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sample story bank entries for local testing only. Clearly sample data.
 */
const sampleStories = [
  {
    title: "9 years building and operating high-traffic services",
    category: "tell_me_about_yourself",
    shortVersion:
      "I'm a senior engineer with about 9 years building and running high-traffic backend services, most recently a payment ledger handling 4M transactions a day.",
    starVersion:
      "Over 9 years I've moved from data pipelines into backend platform work. Lately I lead the payment ledger service at Northwind, where I own reliability and design. I redesigned it to handle 4M transactions a day, and the result was a big latency and incident drop.",
    technicalVersion:
      "I've worked across Python data pipelines, Node/TypeScript APIs, and now Go services on PostgreSQL and Redis. My focus is reliability: read replicas, caching, circuit breakers, and good observability with Prometheus and Grafana.",
    keywords: ["senior", "backend", "Go", "PostgreSQL", "reliability"],
    evidence: ["9 years experience", "payment ledger 4M tx/day", "Staff Engineer at Northwind"],
  },
  {
    title: "Cut p99 latency from 850ms to 180ms",
    category: "performance_optimization",
    shortVersion:
      "I cut p99 latency on our payment ledger from 850ms to 180ms by adding read replicas and a Redis cache layer.",
    starVersion:
      "Our ledger p99 was 850ms and hurting checkout. I profiled the hot paths, found read contention, added PostgreSQL read replicas and a Redis cache for hot keys, and got p99 down to 180ms without changing the data model.",
    technicalVersion:
      "I traced the slow paths with our metrics, saw read amplification on the primary, routed reads to replicas, and cached hot ledger lookups in Redis with careful invalidation. p99 dropped from 850ms to 180ms and the primary write load fell too.",
    keywords: ["p99 latency", "read replicas", "Redis", "PostgreSQL", "profiling"],
    evidence: ["p99 850ms to 180ms", "read replicas + Redis cache"],
  },
  {
    title: "Reduced Sev1 incidents by 40%",
    category: "production_bug",
    shortVersion:
      "I reduced Sev1 incidents by about 40% by adding circuit breakers and better alerting on our payment services.",
    starVersion:
      "We were getting paged on cascading failures. I owned the on-call rotation, added circuit breakers between services and tightened alerting thresholds, then ran postmortems to close gaps. Sev1 incidents dropped about 40%.",
    technicalVersion:
      "Failures cascaded because downstream timeouts piled up. I added circuit breakers with sensible fallbacks, set SLO-based alerts in Prometheus, and added runbooks. That cut Sev1s ~40% and shortened time-to-detect.",
    keywords: ["circuit breakers", "on-call", "alerting", "postmortems", "reliability"],
    evidence: ["Sev1 reduced 40%", "owned on-call rotation"],
  },
  {
    title: "Migrated a monolith to event-driven services",
    category: "architecture_decision",
    shortVersion:
      "I migrated a monolith to event-driven services with Kafka, which improved our deploy frequency about 3x.",
    starVersion:
      "Our monolith made deploys risky and slow. I led a gradual move to event-driven services on Kafka, carving out bounded contexts one at a time so we never had a big-bang cutover. Deploy frequency went up roughly 3x.",
    technicalVersion:
      "I introduced Kafka as the backbone, extracted services by bounded context, and used the strangler pattern with dual-writes during migration. We kept backward compatibility, added consumer idempotency, and tripled deploy frequency.",
    keywords: ["Kafka", "event-driven", "strangler pattern", "bounded context", "deploys"],
    evidence: ["monolith to event-driven", "deploy frequency 3x", "Kafka"],
  },
  {
    title: "Mentored engineers and ran architecture reviews",
    category: "mentoring",
    shortVersion:
      "I mentored four engineers and ran weekly architecture reviews to raise the bar on our team.",
    starVersion:
      "I wanted the team to make better design calls without me in every meeting. I mentored four engineers directly and started weekly architecture reviews where we'd whiteboard tradeoffs. Over time they started leading designs themselves.",
    technicalVersion:
      "In the architecture reviews we'd go through capacity, failure modes, data ownership, and rollout plans. Mentoring was mostly pairing on real changes and reviewing design docs, focusing on tradeoffs rather than prescribing answers.",
    keywords: ["mentoring", "architecture reviews", "tradeoffs", "leadership"],
    evidence: ["mentored 4 engineers", "weekly architecture reviews"],
  },
];

async function main() {
  const count = await prisma.story.count();
  if (count > 0) {
    console.log(`Story bank already has ${count} stories — skipping seed.`);
    return;
  }

  for (const s of sampleStories) {
    await prisma.story.create({
      data: {
        title: s.title,
        category: s.category,
        shortVersion: s.shortVersion,
        starVersion: s.starVersion,
        technicalVersion: s.technicalVersion,
        keywordsJson: JSON.stringify(s.keywords),
        evidenceJson: JSON.stringify(s.evidence),
      },
    });
  }

  console.log(`Seeded ${sampleStories.length} sample stories.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
