export interface BaselineItem {
  text: string;
  correct: string;
  distractors: string[];
  steps: number;
}

export const BASELINE_ITEMS: BaselineItem[] = [
  {
    text:
      "The passage argues that urban green spaces reduce heat and improve wellbeing, but notes funding remains limited.",
    correct: "Green spaces cool cities and support health, yet funding is limited.",
    distractors: [
      "Green spaces increase heat but funding is abundant.",
      "Urban greenery has no effect on heat or wellbeing.",
      "Funding is sufficient and health benefits are overstated.",
    ],
    steps: 3,
  },
  {
    text:
      "The author suggests that remote work boosts productivity for focused tasks, while collaboration may suffer without structure.",
    correct: "Remote work can improve focus, but collaboration needs structure.",
    distractors: [
      "Remote work always harms productivity and collaboration.",
      "Collaboration improves automatically with remote work.",
      "Productivity declines for focused tasks in remote settings.",
    ],
    steps: 2,
  },
  {
    text:
      "According to the report, battery costs have fallen, but supply chain constraints may slow adoption.",
    correct: "Lower battery costs help adoption, though supply chains can slow it.",
    distractors: [
      "Battery costs have risen and adoption is accelerating.",
      "Adoption is unaffected by costs or supply chains.",
      "Supply chains are improving while costs remain high.",
    ],
    steps: 2,
  },
  {
    text:
      "The study indicates that bilingual education improves cognitive flexibility, yet outcomes vary by program quality.",
    correct: "Bilingual education can boost flexibility, but quality affects results.",
    distractors: [
      "Bilingual education harms flexibility regardless of quality.",
      "Program quality is irrelevant to outcomes.",
      "Cognitive flexibility declines as bilingual exposure increases.",
    ],
    steps: 3,
  },
  {
    text:
      "The editorial claims that public transit investment reduces congestion, though initial costs are substantial.",
    correct: "Transit investment can cut congestion despite high upfront costs.",
    distractors: [
      "Transit investment increases congestion and has low costs.",
      "Congestion is unaffected by transit investment.",
      "Upfront costs are low and congestion worsens.",
    ],
    steps: 2,
  },
  {
    text:
      "The analysis notes that water conservation policies work best when paired with consumer education.",
    correct: "Conservation policies are most effective with education.",
    distractors: [
      "Education reduces conservation outcomes.",
      "Policies alone are always sufficient.",
      "Conservation works only without education.",
    ],
    steps: 2,
  },
  {
    text:
      "The author implies that AI tools can assist clinicians, but should not replace human judgment.",
    correct: "AI can support clinicians but should not replace judgment.",
    distractors: [
      "AI should replace clinicians entirely.",
      "AI is unrelated to clinical decision-making.",
      "Human judgment should be replaced by automation.",
    ],
    steps: 2,
  },
  {
    text:
      "The commentary suggests that transparent pricing increases trust, yet some firms avoid disclosure.",
    correct: "Transparent pricing builds trust, but some firms avoid it.",
    distractors: [
      "Pricing transparency reduces trust and is widely used.",
      "Firms always disclose prices, and trust is unchanged.",
      "Avoiding disclosure improves transparency.",
    ],
    steps: 2,
  },
];
