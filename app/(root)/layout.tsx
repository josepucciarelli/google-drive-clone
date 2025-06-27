import React from "react";
import SideBar from "@/components/SideBar";
import MovileNavigation from "@/components/MovileNavigation";
import Header from "@/components/Header";
import { getCurrentUser } from "@/lib/actions/user.actions";
import { redirect } from "next/navigation";

const Layout = async ({ children }: { children: React.ReactNode }) => {
  const currentUser = await getCurrentUser();

  if (!currentUser) return redirect("/sign-in");
  return (
    <main className="flex h-screen">
      <SideBar {...currentUser} />
      <section className="flex h-full flex-1 flex-col">
        <MovileNavigation />
        <Header />
        <div className="main-content">{children}</div>
      </section>
    </main>
  );
};
export default Layout;
