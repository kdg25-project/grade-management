import { Button } from "@/components/ui/button";

import { ApiHealth } from "./api-health";

export default function Home() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">SANSUN ACADEMY</p>
        <h1>SANSUN学園<br />成績管理システム</h1>
        <p className="lead">学生の学びを、正確に、わかりやすく。</p>
        <div className="healthActions">
          <ApiHealth />
          <Button render={<a href="/" />} variant="outline">
            接続を再確認
          </Button>
        </div>
      </section>
    </main>
  );
}
