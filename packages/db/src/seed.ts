import { prisma, seedDiscoverSources } from "./index";

await seedDiscoverSources(prisma);
console.log("Seeded default Discover sources.");
await prisma.$disconnect();
