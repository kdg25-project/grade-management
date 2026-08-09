import Link from "next/link";
import { ArrowRight, ClipboardPenLine } from "lucide-react";

import { prototypeSubjects } from "@/lib/prototype-grade-data";

export default function SubjectsPage() {
  return (
    <>
      <header className="pageHeader">
        <p className="sectionEyebrow">担当科目</p>
        <h1>成績を入力する科目を選ぶ</h1>
        <p>今年度と入力する学期を確認して、科目を選択してください。</p>
      </header>

      <section className="prototypeNotice" aria-label="画面確認用の案内">
        <ClipboardPenLine aria-hidden="true" />
        <div><strong>画面確認用データを表示しています</strong><p>担当科目・入力状況は仮の内容です。業務APIと認証ガードは未接続です。</p></div>
      </section>

      <section aria-labelledby="subjects-heading">
        <div className="sectionTitle"><div><p className="sectionEyebrow">2026年度 前期</p><h2 id="subjects-heading">担当科目</h2></div><p>前期の成績が教務で確定した後、後期の入力へ切り替わります。</p></div>
        <div className="subjectList">
          {prototypeSubjects.map((subject) => (
            <article className={subject.isCurrentEntry ? "subjectCard currentSubject" : "subjectCard"} key={subject.id}>
              <div className="subjectStatus"><span className={subject.isCurrentEntry ? "statusIcon current" : "statusIcon"} aria-hidden="true" />{subject.isCurrentEntry ? "いま入力する科目" : subject.entryStatus}</div>
              <div className="subjectInfo"><h3>{subject.name}</h3><p>{subject.className}</p><dl><div><dt>年度</dt><dd>{subject.year}</dd></div><div><dt>学期</dt><dd>{subject.term}</dd></div><div><dt>入力状況</dt><dd>{subject.entryStatus}</dd></div></dl><p className="subjectDescription">{subject.description}</p></div>
              <Link className="subjectLink" href={`/teacher/subjects/${subject.id}/grades`}><span>成績表を開く</span><ArrowRight aria-hidden="true" /></Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
