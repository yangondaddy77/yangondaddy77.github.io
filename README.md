# 내맘대로 글 모음

네이버 블로그에 **이미 공개된 글**의 제목과 주소만 모아, 구글이 찾을 수 있게 하는 정적 허브입니다.

- 내맘대로 스포츠: https://blog.naver.com/yangon_daddy
- 내맘대로 음악: https://blog.naver.com/jpopsakurazaka

사이트 주소는 https://yangondaddy77.github.io/ 입니다. 본문과 이미지는 담지 않습니다. 각 항목은 제목, 날짜, 카테고리, 네이버 글 링크만 있습니다.

페이지는 저장소 **기본 브랜치(`main`)의 루트(`/`)** 에 있습니다. 별도 배포 권한은 쓰지 않습니다. GitHub Pages가 이 폴더를 그대로 제공합니다. `.nojekyll` 파일이 있어서 Jekyll은 켜지지 않습니다.

## GitHub Pages 켜기

이 변경을 `main`에 합친 뒤 설정합니다.

1. 저장소 **Settings → Pages**
2. **Build and deployment**의 Source를 **Deploy from a branch**로 선택
3. Branch는 **main**, Folder는 **/ (root)** 로 선택하고 Save

몇 분 뒤 https://yangondaddy77.github.io/ 에서 목록이 열립니다.

## 글 목록 갱신

`.github/workflows/update-posts.yml`이 하루 두 번, 그리고 수동으로 실행됩니다.

- 매일 **07:30 KST** (UTC 22:30)
- 매일 **19:30 KST** (UTC 10:30)

수동 실행: **Actions → 글 목록 갱신 → Run workflow**. `main`에서 실행합니다.

바뀐 글이 있으면 `github-actions[bot]`이 `글 목록 갱신` 메시지로 `main`에 커밋합니다. RSS를 가져오지 못하거나 형식이 다르면 `data/posts.json`과 페이지는 그대로 두고 워크플로만 실패합니다. 기본 `GITHUB_TOKEN`의 `contents: write`만 사용합니다. 비밀 값은 필요 없습니다.

워크플로가 `main`에 푸시하려면 Actions의 기본 토큰이 그 브랜치에 쓸 수 있어야 합니다.

로컬에서 같은 일을 하려면 Node.js 22에서 저장소 루트로 이동합니다.

```bash
npm test
npm run update
```

`npm test`는 네트워크 없이 샘플 RSS로 파싱과 병합만 확인합니다. `npm run update`는 두 블로그의 공개 RSS를 읽어 목록을 합칩니다.

## 구글 서치 콘솔

1. [Google Search Console](https://search.google.com/search-console)에서 속성 `https://yangondaddy77.github.io/`를 추가합니다.
2. 소유권 확인이 HTML 파일이면, 받은 파일(예: `google123.html`)을 이 저장소 **루트**에 넣고 `main`에 올립니다. 확인 주소는 `https://yangondaddy77.github.io/google123.html`이 됩니다.
3. 확인이 끝나면 Sitemaps에 `sitemap.xml`을 제출합니다. 전체 주소는 `https://yangondaddy77.github.io/sitemap.xml`입니다.

## 데이터

`data/posts.json`에 글 주소(logNo) 기준으로 중복 없이 쌓입니다. 네이버 RSS는 최근 약 50개만 주므로, 그 창 밖으로 밀려난 글도 이 파일에 남습니다. 다시 나타난 글은 제목·날짜·카테고리만 고칩니다. 목록에 없는 글을 지우지는 않습니다.
