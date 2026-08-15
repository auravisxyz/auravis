import ConfirmClient from "./ConfirmClient";

export default async function ConfirmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConfirmClient draftId={id} />;
}
