"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";
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
  const { t } = useLanguage();
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

  // Trạng thái khung giờ nhận check-in (null = chưa biết → không chặn)
  const [windowOpen, setWindowOpen] =
    useState<boolean | null>(null);
  const [windowInfo, setWindowInfo] = useState<{
    open: string;
    close: string;
    now: string;
  } | null>(null);

  // ==========================================================
  // KIỂM TRA KHUNG GIỜ NHẬN CHECK-IN (giờ máy chủ, giờ VN)
  // ==========================================================

  useEffect(() => {
    let active = true;

    async function checkWindow() {
      const { data, error } = await supabase
        .rpc("checkin_window_open")
        .maybeSingle();

      if (!active) return;

      // Nếu hàm chưa tồn tại / lỗi mạng: không chặn (fail-open),
      // backend vẫn là lớp chốt cuối cùng.
      if (error || !data) {
        setWindowOpen(null);
        return;
      }

      const row = data as {
        is_open: boolean;
        open_time: string;
        close_time: string;
        server_time: string;
      };

      setWindowOpen(row.is_open);
      setWindowInfo({
        open: row.open_time,
        close: row.close_time,
        now: row.server_time,
      });
    }

    checkWindow();
    const timer = setInterval(checkWindow, 30000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

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
      setErrorMessage(t("checkin.flow.errors.loadCategoriesFailed"));
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
      setErrorMessage(t("checkin.flow.errors.noBranch"));
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
      setErrorMessage(t("checkin.flow.errors.missingInfo"));

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
          getCheckinErrorMessage(error.message, t)
        );

        setLoading(false);
        setStep("error");
        return;
      }

      // ------------------------------------------------------
      // NO DATA
      // ------------------------------------------------------

      if (!data) {
        setErrorMessage(t("checkin.flow.errors.genericCheckinFailed"));

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

      setErrorMessage(t("checkin.flow.errors.genericCheckinFailed"));

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
  // RENDER — NGOÀI GIỜ NHẬN CHECK-IN
  // Chỉ chặn ở các bước TRƯỚC khi tạo ticket, không che màn thành công.
  // ==========================================================

  const preSubmitStep =
    step === "welcome" ||
    step === "identify" ||
    step === "not_found" ||
    step === "needs" ||
    step === "description";

  if (windowOpen === false && preSubmitStep) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher variant="kiosk" />
          </div>
          <div className="rounded-card bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent-100">
            <span className="font-display text-3xl">🕒</span>
          </div>

          <p className="font-display text-2xl font-semibold text-brand-900">
            {t("checkin.flow.outsideHoursTitle")}
          </p>

          <p className="mt-3 font-body text-base text-ink/70">
            {t("checkin.flow.outsideHoursPrefix")}{" "}
            <b className="text-brand-700">
              {windowInfo?.open ?? "08:25"}
            </b>{" "}
            {t("checkin.flow.outsideHoursTo")}{" "}
            <b className="text-brand-700">
              {windowInfo?.close ?? "17:45"}
            </b>{" "}
            {t("checkin.flow.outsideHoursTz")}
          </p>

          {windowInfo?.now && (
            <p className="mt-2 font-body text-sm text-ink/50">
              {t("checkin.flow.currentTime", { time: windowInfo.now })}
            </p>
          )}

          <p className="mt-5 font-body text-sm text-ink/50">
            {t("checkin.flow.comeBack")}
          </p>
          </div>
        </div>
      </div>
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
              {t("checkin.flow.submitting")}
            </p>

            <p className="mt-2 font-body text-sm text-ink/50">
              {t("checkin.flow.doNotClickAgain")}
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
          message={errorMessage ?? t("common.genericError")}
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
  message: string,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (!message) {
    return t("checkin.flow.errors.genericCheckinFailed");
  }

  // ----------------------------------------------------------
  // Ngoài giờ nhận check-in (08:25–17:45, giờ VN)
  // ----------------------------------------------------------

  if (message.includes("CHECKIN_CLOSED")) {
    return (
      message
        .replace(/^[\s\S]*CHECKIN_CLOSED:\s*/, "")
        .trim() ||
      t("checkin.flow.errors.outsideHoursFallback")
    );
  }

  // ----------------------------------------------------------
  // Driver đang có ticket active — message này do backend (Postgres)
  // sinh ra bằng tiếng Việt, giữ nguyên vì không thể dịch động phía
  // client. Muốn đa ngôn ngữ đầy đủ cần cập nhật thông báo lỗi trong
  // SQL function (ví dụ trả thêm mã lỗi thay vì text).
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
    return t("checkin.flow.errors.duplicate");
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
    return t("checkin.flow.errors.permission");
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
    return t("checkin.flow.errors.branchUnresolved");
  }

  // ----------------------------------------------------------
  // Fallback
  // ----------------------------------------------------------

  return message;
}
