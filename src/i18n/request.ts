import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  const base = (await import(`../../messages/${locale}.json`)).default;
  const seo = (await import(`../../messages/seo/${locale}.json`)).default;

  return {
    locale,
    messages: { ...base, seo },
  };
});
