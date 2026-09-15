import Link from "next/link";
import { ArrowRight, BookText, CalendarDays, History, Mic, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const cards = [
  {
    href: "/calendar",
    title: "Calendar",
    description: "See your Job Track interview calendar and jump into a live session.",
    icon: CalendarDays,
  },
  {
    href: "/session",
    title: "Session",
    description:
      "Start from a calendar event, keep ChatGPT in view, and generate spoken answers from captions or a specific question.",
    icon: Mic,
  },
  {
    href: "/stories",
    title: "Stories",
    description: "Build a story bank with short, STAR, and technical versions of your wins.",
    icon: BookText,
  },
  {
    href: "/history",
    title: "History",
    description: "Review past sessions, export to Markdown, and generate a post-interview review.",
    icon: History,
  },
  {
    href: "/settings",
    title: "Settings",
    description: "Configure models, answer defaults, keyboard behavior, and local data.",
    icon: Settings,
  },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Interview Copilot</h1>
        <p className="max-w-2xl text-muted-foreground">
          A local-first, real-time interview assistant for your own preparation and permitted
          live coaching. It listens to captions or audio, detects the interviewer&apos;s latest
          question, and drafts a short, grounded answer you can say out loud.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild>
            <Link href="/calendar">
              Open calendar <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/session">Go to live session</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/60">
                <CardHeader>
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="pt-2">{card.title}</CardTitle>
                  <CardDescription>{card.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Open <ArrowRight className="ml-1 inline h-3 w-3" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
