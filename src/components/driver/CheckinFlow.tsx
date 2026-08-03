"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  Branch,
  CheckinResult,
  CheckinStep,
  DriverLookupResult,
  ServiceCategory,
  ServiceSubcategory,
} from "@/lib/types";
import {
  BranchStep,
  CategoryStep,
  DescriptionStep,
  DriverFoundStep,
  ErrorStep,
  IdentifyStep,
  NotFoundStep,
  SubcategoryStep,
  SuccessStep,
  WelcomeStep,
} from "./steps";

const KIOSK_BRANCH_CODE = process.env.NEXT_PUBLIC_KIOSK_BRANCH_CODE ?? null;
const AUTO_RESET_MS = 8000;

export default function CheckinFlow() {
  const [step, setStep] = useState<CheckinStep>("welcome");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchOptions, setBranchOptions] = useState<Branch[]>([]);

  const [driver, setDriver] = useState<DriverLookupResult | null>(null);

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [subcategory, setSubcategory] = useState<ServiceSubcategory | null>(
    null
  );

  const [result, setResult] = useState<CheckinResult | null>(null);

  // Section 7: resolve branch — kiosk-bound via env, otherwise ask.
  useEffect(() => {
    async function resolveBranch() {
      if (KIOSK_BRANCH_CODE) {
        const { data } = await supabase
          .from("branches")
          .select("id, branch_code, branch_name")
          .eq("branch_code", KIOSK_BRANCH_CODE)
          .eq("status", "ACTIVE")
          .maybeSingle();
        if (data) {
          setBranch(data);
          return;
        }
      }
      const { data } = await supabase
        .from("branches")
        .select("id, branch_code, branch_name")
        .eq("status", "ACTIVE");
      if (data && data.length === 1) {
        setBranch(data[0]);
      } else if (data) {
        setBranchOptions(data);
      }
    }
    resolveBranch();
  }, []);

  function resetAll() {
    setStep("welcome");
    setDriver(null);
    setCategory(null);
    setSubcategory(null);
    setResult(null);
    setErrorMessage(null);
  }

  async function handleIdentify(identifier: string) {
    setLoading(true);
    setErrorMessage(null);
    const { data, error } = await supabase
      .rpc("lookup_driver", { p_identifier: identifier })
      .maybeSingle();
    setLoading(false);

    if (error || !data) {
      setStep("not_found");
      return;
    }
    setDriver(data as DriverLookupResult);
    setStep("identify"); // shows DriverFoundStep confirmation via driver != null below
  }

  async function loadCategories() {
    const { data } = await supabase
      .from("service_categories")
      .select("id, name, code, display_order")
      .eq("status", "ACTIVE")
      .order("display_order");
    setCategories(data ?? []);
  }

  async function handleConfirmDriver() {
    if (!branch && branchOptions.length > 0) {
      setStep("welcome"); // guard: branch must resolve first — shouldn't normally happen
      return;
    }
    await loadCategories();
    setStep("category");
  }

  async function handleSelectCategory(c: ServiceCategory) {
    setCategory(c);
    const { data } = await supabase
      .from("service_subcategories")
      .select("id, category_id, name, code, display_order")
      .eq("category_id", c.id)
      .eq("status", "ACTIVE")
      .order("display_order");
    setSubcategories(data ?? []);
    setStep("subcategory");
  }

  function handleSelectSubcategory(s: ServiceSubcategory) {
    setSubcategory(s);
    setStep("description");
  }

  async function handleSubmitDescription(description: string) {
    if (!driver || !branch || !category) {
      setErrorMessage("Thiếu thông tin cần thiết, vui lòng thử lại từ đầu.");
      setStep("error");
      return;
    }
    setStep("submitting");
    const { data, error } = await supabase
      .rpc("create_checkin", {
        p_driver_id: driver.id,
        p_branch_id: branch.id,
        p_category_id: category.id,
        p_subcategory_id: subcategory?.id ?? null,
        p_description: description || null,
      })
      .maybeSingle();

    if (error || !data) {
      setErrorMessage(
        "Không thể tạo check-in lúc này. Vui lòng thử lại hoặc liên hệ nhân viên Green SM."
      );
      setStep("error");
      return;
    }
    setResult(data as CheckinResult);
    setStep("success");
  }

  // Kiosk mode: auto-return to welcome screen after a successful check-in.
  useEffect(() => {
    if (step !== "success") return;
    const t = setTimeout(resetAll, AUTO_RESET_MS);
    return () => clearTimeout(t);
  }, [step]);

  if (branchOptions.length > 1 && !branch) {
    return <BranchStep branches={branchOptions} onSelect={setBranch} />;
  }

  switch (step) {
    case "welcome":
      return <WelcomeStep onStart={() => setStep("identify")} />;

    case "identify":
      return driver ? (
        <DriverFoundStep
          driver={driver}
          onConfirm={handleConfirmDriver}
          onRetry={() => setDriver(null)}
        />
      ) : (
        <IdentifyStep loading={loading} onSubmit={handleIdentify} />
      );

    case "not_found":
      return (
        <NotFoundStep
          onRetry={() => {
            setDriver(null);
            setStep("identify");
          }}
        />
      );

    case "category":
      return <CategoryStep categories={categories} onSelect={handleSelectCategory} />;

    case "subcategory":
      return (
        <SubcategoryStep
          categoryName={category?.name ?? ""}
          subcategories={subcategories}
          onSelect={handleSelectSubcategory}
          onBack={() => setStep("category")}
        />
      );

    case "description":
      return <DescriptionStep onSubmit={handleSubmitDescription} />;

    case "submitting":
      return (
        <div className="flex min-h-screen items-center justify-center font-display text-2xl text-brand-700">
          Đang xử lý check-in...
        </div>
      );

    case "success":
      return result ? (
        <SuccessStep
          queueNumber={result.queue_number}
          categoryName={category?.name ?? ""}
          ticketCode={result.ticket_code}
          onDone={resetAll}
        />
      ) : null;

    case "error":
      return (
        <ErrorStep
          message={errorMessage ?? "Đã có lỗi xảy ra."}
          onRetry={resetAll}
        />
      );

    default:
      return null;
  }
}
