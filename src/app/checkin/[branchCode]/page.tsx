"use client";

import { useParams } from "next/navigation";
import CheckinFlow from "@/components/driver/CheckinFlow";

/*
 * Link check-in riêng cho từng văn phòng: /checkin/HCM01, /checkin/HN01...
 * Kiosk của mỗi văn phòng mở đúng link của mình nên tài xế không chọn nhầm văn phòng.
 */
export default function BranchCheckinPage() {
  const params = useParams<{ branchCode: string }>();
  return <CheckinFlow branchCode={params.branchCode} />;
}
