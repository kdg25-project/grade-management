import Link from "next/link";
import { ChevronLeft, Monitor } from "lucide-react";

import { GradeEntryTable } from "@/components/grade-entry-table";
import { prototypeSubjects } from "@/lib/prototype-grade-data";

export default async function GradesPage({ params }: Readonly<{ params: Promise<{ subjectId: string }> }>) {
  const { subjectId } = await params;
  const subject = prototypeSubjects.find((item) => item.id === subjectId) ?? prototypeSubjects[0];

  return (
    <>
      <Link className="backLink" href="/teacher/subjects"><ChevronLeft aria-hidden="true" />担当科目に戻る</Link>
      <header className="pageHeader gradeHeader">
        <p className="sectionEyebrow">{subject.year} {subject.term} / {subject.className}</p>
        <h1>{subject.name}の成績表</h1>
        <p>入力できるのは現在の学期です。確定の操作は、この画面にはありません。</p>
      </header>

      <section className="prototypeNotice compactNotice" aria-label="画面確認用の案内">
        <Monitor aria-hidden="true" />
        <div><strong>画面確認用の編集体験です</strong><p>入力内容はこの画面内だけで変わります。Hono RPC・保存・確定処理には接続していません。</p></div>
      </section>
      <GradeEntryTable />
    </>
  );
}
