import CatchClient from "./CatchClient";

export default async function CatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CatchClient executionId={id} />;
}
