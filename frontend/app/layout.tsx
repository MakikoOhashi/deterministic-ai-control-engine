import "./globals.css";

export const metadata = {
  title: "Stable Difficulty Generation Engine",
  description: "Evaluation-controlled generation engine for guided reading items",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
