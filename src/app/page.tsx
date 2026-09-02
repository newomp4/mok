"use client";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@/components/editor/Editor"), { ssr: false });

export default function Page() {
  return <Editor />;
}
