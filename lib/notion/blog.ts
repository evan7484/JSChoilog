import { notion, n2m, queryDatabase } from "./client";
import { getColorGradient } from "./colors";
import type { BlogPost } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPageToBlogPost(page: any): BlogPost {
  const props = page.properties;

  return {
    id: page.id,
    title: props.Title?.title?.[0]?.plain_text || "",
    category: props.Category?.select?.name || "",
    date: props.Date?.date?.start || "",
    excerpt: props.Excerpt?.rich_text?.[0]?.plain_text || "",
    readTime: props.ReadTime?.number || 0,
    tags:
      props.Tags?.multi_select?.map((tag: { name: string }) => tag.name) || [],
    color: getColorGradient(props.Color?.select?.name || "Blue"),
    releasable: props.Published?.checkbox || false,
    likes: props.Likes?.number || 0,
    // Notion 업로드 파일 URL은 만료가 있으므로(약 1시간) ISR 주기를 그보다 짧게 유지할 것
    cover: page.cover?.external?.url || page.cover?.file?.url || "",
    slug: props.Slug?.rich_text?.[0]?.plain_text || "",
  };
}

// 페이지의 블록 내용을 마크다운으로 변환 (실패 시 fallback 사용)
export async function getPageContent(
  pageId: string,
  fallback = ""
): Promise<string> {
  try {
    const mdblocks = await n2m.pageToMarkdown(pageId);
    return n2m.toMarkdownString(mdblocks).parent;
  } catch (error) {
    console.error(`Failed to fetch blocks for page ${pageId}:`, error);
    return fallback;
  }
}

// 목록용 조회 — 본문(content)은 상세 페이지에서만 필요하므로
// 글마다 블록을 변환하는 N+1 호출을 하지 않는다
export async function getBlogPosts(): Promise<BlogPost[]> {
  if (!process.env.NOTION_POSTS_DATABASE_ID) {
    throw new Error("NOTION_POSTS_DATABASE_ID is not set");
  }

  const response = await queryDatabase(
    process.env.NOTION_POSTS_DATABASE_ID,
    {
      property: "Published",
      checkbox: {
        equals: true,
      },
    },
    [
      {
        property: "Date",
        direction: "descending",
      },
    ]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return response.results.map((page: any) => mapPageToBlogPost(page));
}

// 본문 없이 메타데이터만 — OG 이미지 생성 등 가벼운 소비처용
export async function getBlogPostMeta(id: string): Promise<BlogPost | null> {
  try {
    const page = await notion.pages.retrieve({ page_id: id });
    const post = mapPageToBlogPost(page);

    // 미공개 글은 노출하지 않는다
    if (!post.releasable) return null;

    return post;
  } catch (error) {
    console.error("Failed to fetch blog post:", error);
    return null;
  }
}

// 슬러그로 조회 (본문 제외) — Notion DB에 Slug 속성이 없으면 쿼리가 400이므로 null 처리
export async function getBlogPostMetaBySlug(
  slug: string
): Promise<BlogPost | null> {
  if (!process.env.NOTION_POSTS_DATABASE_ID || !slug) return null;

  try {
    const response = await queryDatabase(process.env.NOTION_POSTS_DATABASE_ID, {
      and: [
        { property: "Slug", rich_text: { equals: slug } },
        { property: "Published", checkbox: { equals: true } },
      ],
    });

    const page = response.results[0];
    return page ? mapPageToBlogPost(page) : null;
  } catch (error) {
    console.error("Failed to fetch post by slug:", error);
    return null;
  }
}
