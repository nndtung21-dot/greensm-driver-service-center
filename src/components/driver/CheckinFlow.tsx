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
  DescriptionStep,
  DriverFoundStep,
  ErrorStep,
  IdentifyStep,
  NeedsStep,
  NotFoundStep,
  SuccessStep,
  WelcomeStep,
} from "./steps";

const KIOSK_BRANCH_CODE =
  process.env.NEXT_PUBLIC_KIOSK_BRANCH_CODE ?? null;

export default function CheckinFlow() {
  const [step, setStep] = useState<CheckinStep>("welcome");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchOptions, setBranchOptions] = useState<Branch[]>([]);

  const [driver, setDriver] =
    useState<DriverLookupResult | null>(null);

  const [categories, setCategories] =
    useState<ServiceCategory[]>([]);

  const [category, setCategory] =
    useState<ServiceCategory | null>(null);

  const [subcategory, setSubcategory] =
    useState<ServiceSubcategory | null>(null);

  const [result, setResult] =
    useState<CheckinResult | null>(null);

  // ==========================================================
  // RESOLVE BRANCH
  // ==========================================================

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

  // ==========================================================
  // RESET
  // ==========================================================

  function resetAll() {
    setStep("welcome");
    setLoading(false);
    setDriver(null);
    setCategory(null);
    setSubcategory(null);
    setResult(null);
    setErrorMessage(null);
  }

  // ==========================================================
  // IDENTIFY DRIVER
  // ==========================================================

  async function handleIdentify(identifier: string) {
    if (loading) return;

    setLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .rpc("lookup_driver", {
        p_identifier: identifier,
      })
      .maybeSingle();

    setLoading(false);

    if (error || !data) {
      setStep("not_found");
      return;
    }

    setDriver(data as DriverLookupResult);
    setStep("identify");
  }

  // ==========================================================
  // LOAD CATEGORIES
  // ==========================================================

  async function loadCategories() {
    const { data, error } = await supabase
      .from("service_categories")
      .select(
        "id, name, code, display_order"
      )
      .eq("status", "ACTIVE")
      .order("display_order");

    if (error) {
      setErrorMessage(
        "Không thể tải danh sách nhu cầu. Vui lòng thử lại."
      );
      return;
    }

    setCategories(data ?? []);
  }

  // ==========================================================
  // CONFIRM DRIVER
  // ==========================================================

  async function handleConfirmDriver() {
    if (loading) return;

    if (!branch && branchOptions.length > 0) {
      setStep("welcome");
      return;
    }

    if (!branch) {
      setErrorMessage(
        "Chưa xác định được văn phòng. Vui lòng thử lại."
      );
      setStep("error");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    await loadCategories();

    setLoading(false);
    setStep("needs");
  }

  // ==========================================================
  // LOAD SUBCATEGORIES
  // ==========================================================

  async function fetchSubcategoriesFor(
    categoryId: string
  ): Promise<ServiceSubcategory[]> {
    const { data } = await supabase
      .from("service_subcategories")
      .select(
        "id, category_id, name, code, display_order"
      )
      .eq("category_id", categoryId)
      .eq("status", "ACTIVE")
      .order("display_order");

    return data ?? [];
  }

  // ==========================================================
  // SELECT NEED
  // ==========================================================

  function handleNeedsContinue(
    selectedCategory: ServiceCategory,
    selectedSubcategory:
      | ServiceSubcategory
      | null
  ) {
    setCategory(selectedCategory);
    setSubcategory(selectedSubcategory);
    setStep("description");
  }

  // ==========================================================
  // SUBMIT CHECK-IN
  // ==========================================================

  async function handleSubmitDescription(
    description: string
  ) {
    // --------------------------------------------------------
    // Chặn double click ở frontend
    // --------------------------------------------------------

    if (loading) return;

    // --------------------------------------------------------
    // Validate
    // --------------------------------------------------------

    if (!driver || !branch || !category) {
      setErrorMessage(
        "Thiếu thông tin cần thiết, vui lòng thử lại từ đầu."
      );

      setStep("error");
      return;
    }

    // --------------------------------------------------------
    // Lock UI trước khi gọi RPC
    // --------------------------------------------------------

    setLoading(true);
    setErrorMessage(null);
    setStep("submitting");

    try {
      const { data, error } = await supabase
        .rpc("create_checkin", {
          p_driver_id: driver.id,
          p_branch_id: branch.id,
          p_category_id: category.id,
          p_subcategory_id:
            subcategory?.id ?? null,
          p_description:
            description.trim() || null,
        })
        .maybeSingle();

      // ------------------------------------------------------
      // RPC ERROR
      // ------------------------------------------------------

      if (error) {
        console.error(
          "create_checkin error:",
          error
        );

        /*
         * SQL hiện tại đã chặn:
         *
         * WAITING
         * CALLED
         * PROCESSING
         * PENDING
         *
         * nên ở đây lấy message từ PostgreSQL
         * để hiển thị đúng lý do.
         */

        setErrorMessage(
          getCheckinErrorMessage(error.message)
        );

        setLoading(false);
        setStep("error");
        return;
      }

      // ------------------------------------------------------
      // NO DATA
      // ------------------------------------------------------

      if (!data) {
        setErrorMessage(
          "Không nhận được kết quả check-in. Vui lòng thử lại."
        );

        setLoading(false);
        setStep("error");
        return;
      }

      // ------------------------------------------------------
      // SUCCESS
      // ------------------------------------------------------

      setResult(data as CheckinResult);

      setLoading(false);
      setStep("success");
    } catch (err) {
      console.error(
        "Unexpected create_checkin error:",
        err
      );

      setErrorMessage(
        "Không thể tạo check-in lúc này. Vui lòng thử lại."
      );

      setLoading(false);
      setStep("error");
    }
  }

  // ==========================================================
  // RENDER BRANCH SELECT
  // ==========================================================

  if (branchOptions.length > 1 && !branch) {
    return (
      <BranchStep
        branches={branchOptions}
        onSelect={setBranch}
      />
    );
  }

  // ==========================================================
  // RENDER FLOW
  // ==========================================================

  switch (step) {
    // --------------------------------------------------------
    // WELCOME
    // --------------------------------------------------------

    case "welcome":
      return (
        <WelcomeStep
          onStart={() => {
            setErrorMessage(null);
            setStep("identify");
          }}
        />
      );

    // --------------------------------------------------------
    // IDENTIFY
    // --------------------------------------------------------

    case "identify":
      return driver ? (
        <DriverFoundStep
          driver={driver}
          onConfirm={handleConfirmDriver}
          onRetry={() => {
            if (loading) return;

            setDriver(null);
            setErrorMessage(null);
          }}
        />
      ) : (
        <IdentifyStep
          loading={loading}
          onSubmit={handleIdentify}
        />
      );

    // --------------------------------------------------------
    // NOT FOUND
    // --------------------------------------------------------

    case "not_found":
      return (
        <NotFoundStep
          onRetry={() => {
            setDriver(null);
            setErrorMessage(null);
            setStep("identify");
          }}
        />
      );

    // --------------------------------------------------------
    // NEEDS
    // --------------------------------------------------------

    case "needs":
      return (
        <NeedsStep
          categories={categories}
          fetchSubcategories={
            fetchSubcategoriesFor
          }
          onContinue={handleNeedsContinue}
        />
      );

    // --------------------------------------------------------
    // DESCRIPTION
    // --------------------------------------------------------

    case "description":
      return (
        <DescriptionStep
          onSubmit={
            handleSubmitDescription
          }
        />
      );

    // --------------------------------------------------------
    // SUBMITTING
    // --------------------------------------------------------

    case "submitting":
      return (
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="text-center">
            <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-brand-100 border-t-brand-700" />

            <p className="font-display text-2xl font-semibold text-brand-700">
              Đang xử lý check-in...
            </p>

            <p className="mt-2 font-body text-sm text-ink/50">
              Vui lòng không bấm lại.
            </p>
          </div>
        </div>
      );

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    case "success":
      return result ? (
        <SuccessStep
          queueNumber={result.queue_number}
          categoryName={
            category?.name ?? ""
          }
          ticketCode={result.ticket_code}
          onReset={resetAll}
        />
      ) : null;

    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    case "error":
      return (
        <ErrorStep
          message={
            errorMessage ??
            "Đã có lỗi xảy ra."
          }
          onRetry={resetAll}
        />
      );

    // --------------------------------------------------------
    // DEFAULT
    // --------------------------------------------------------

    default:
      return null;
  }
}

// ============================================================
// CHECK-IN ERROR MESSAGE
// ============================================================

function getCheckinErrorMessage(
  message: string
): string {
  if (!message) {
    return "Không thể tạo check-in lúc này. Vui lòng thử lại.";
  }

  // ----------------------------------------------------------
  // Driver đang có ticket active
  // ----------------------------------------------------------

  if (
    message.includes(
      "đang có ticket"
    )
  ) {
    return message;
  }

  // ----------------------------------------------------------
  // Duplicate / unique constraint
  // ----------------------------------------------------------

  if (
    message.includes(
      "duplicate key"
    ) ||
    message.includes(
      "unique constraint"
    )
  ) {
    return "Tài xế vừa check-in rồi. Vui lòng kiểm tra lại số thứ tự thay vì check-in lần nữa.";
  }

  // ----------------------------------------------------------
  // Permission
  // ----------------------------------------------------------

  if (
    message.includes(
      "permission denied"
    ) ||
    message.includes(
      "Không có quyền"
    )
  ) {
    return "Bạn không có quyền thực hiện check-in này.";
  }

  // ----------------------------------------------------------
  // Branch
  // ----------------------------------------------------------

  if (
    message.includes(
      "branch"
    ) ||
    message.includes(
      "văn phòng"
    )
  ) {
    return "Không xác định được văn phòng check-in. Vui lòng thử lại hoặc liên hệ nhân viên Green SM.";
  }

  // ----------------------------------------------------------
  // Fallback
  // ----------------------------------------------------------

  return message;
}
