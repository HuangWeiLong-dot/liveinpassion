-- 0010_legacy_html_to_md.sql
-- 6 篇早期文章是 content_format='html'、content_md=NULL：后台 Markdown 编辑器打开是空的，
-- 改动保存不到正文。这里把它们的 HTML 转成 Markdown 写进 content_md，并切到 md 格式。
-- 只补空值，不覆盖已有 content_md；也不动 content_html —— 线上仍是旧 HTML，直到后台保存一次。

-- In the Middle of the World
UPDATE posts
   SET content_format = 'md',
       content_md = 'I watched Moonlight on a laptop at eight in the morning. It is a film about skin and water and light, and my screen made all of it smaller. It still got through.I am still thinking about a boy floating in the sea with a grown man''s hand under his back.

 Juan is a drug dealer. He is also the only adult in the film who asks Chiron a real question and then waits for the answer. He teaches him to swim, tells him that in moonlight black boys look blue, and a few scenes later you find out he sells to Chiron''s mother. The film does not balance those two facts or explain them away. It lets them sit in the same body, the way they do in actual people.

> In moonlight, black boys look blue.

 Three names
 Little, Chiron, Black. The chapter titles give the whole thing away before it starts. The first is what the neighbourhood calls him, the second is what his mother shouts when she is not really shouting at him, the third is what he builds after deciding that soft is not survivable. By the last chapter he is wearing gold and driving with the windows down, and it mostly looks like a costume he never got around to taking off.

 What got me was how little anybody says. His mother loves him and cannot say it without screaming. Kevin cannot say it at all until twenty minutes before the end. Chiron spends most of three chapters looking at the ground. Everything is shot blue, and somewhere around the beach scene the blue stops being a colour and turns into the temperature of the room.

 The diner
 At the end Kevin cooks him a meal, and Chiron says: you''re the only man who''s ever touched me. Then he says it happened in the middle of the world. It is not a good sentence. He says it badly, with a pause in the wrong place, and that is the part I keep replaying, because it is how the true things come out when you have spent a whole life not saying them.

 I have been trying to say the important things sooner than I am comfortable with. That goes against most of what I taught myself about keeping a straight face. Watching a man mumble the truest sentence of his life into a plate of food made me want to be less impressive and more honest.

 Two hours of people not saying it, then one minute of someone saying it. That is the whole film, and it is enough.',
       updated_at = datetime('now')
 WHERE slug = 'in-the-middle-of-the-world'
   AND (content_md IS NULL OR content_md = '');

-- Before Heading Out
UPDATE posts
   SET content_format = 'md',
       content_md = 'A year. That''s how long I''ve been away from school. People kept asking when I''d go back, like it was only about a date. It wasn''t — it was about whether the version of me that left could still fit into the desk I left behind.

 What school never taught me
 A year away will teach you more than four years in. Some lessons only land when you''re alone with them — no syllabus, no grade. Nobody teaches you how to sit with yourself when the noise stops, what to do at 3 a.m. when you''re the only one awake in your own head. The hardest classes aren''t the ones you register for — they''re the ones life enrolls you in, and there''s no dropping them.

> The things that change you the most are the things no one thought to warn you about.

 Loneliness
 It''s not the movie version — no rain on the window. It''s quieter: eating alone because everyone''s busy, not wanting to ask because you don''t want to be the one who always asks. Having things to say and no one to interrupt. The long stretch of evening that should''ve been shared.

 And here''s something I''m not embarrassed to say out loud: I want a girlfriend. Not as a fix — I learned that the hard way. Someone to be quiet with. Someone to be known by. I spent a long time pretending wanting closeness was a weakness. It''s not. But the loneliness taught me I had to learn to be okay alone first — otherwise you don''t find a person, you find a place to put the empty.

 The mind, and how to keep it
 This is the part nobody warned me about either — how thin the line gets between "I''m fine" and "I''m not." How a bad month quietly becomes a bad year. I didn''t know I was carrying psychological weight until it started leaking into everything: sleep, appetite, the way I answered my own name. The mind doesn''t announce its problems — it normalizes them, until "off" feels like your baseline.

 What helped wasn''t dramatic. Sleep. Sunlight. Honest conversations with people who don''t flinch. Knowing the difference between a bad day and a bad season, and the nerve to ask for help when it''s the second one. Therapy isn''t weakness. Medication isn''t failure. Saying "I''m not okay" is the first chapter of getting okay.

> You can''t think your way out of a mind that''s unwell. Sometimes you have to let other people hold the flashlight.

 Before heading out
 So this is the last update before I go back. I''m bringing the year with me — the loneliness, the wanting, the bad weeks, the slow climb back. The things nobody taught me and nobody warned me about. They''re the only curriculum that ever stuck.

 Be brave. Be genuine. Be humble. Take care of your mind — it''s the only one you get. And don''t be a dick, especially not to yourself.',
       updated_at = datetime('now')
 WHERE slug = 'before-heading-out'
   AND (content_md IS NULL OR content_md = '');

-- Don't Be a Dick
UPDATE posts
   SET content_format = 'md',
       content_md = 'We were playing basketball. 5 on 5 full-court basketball. We were playing, we were having a lot of fun, you know.

 And you know basketball, right? There is always a mood like players to players. We may have body contact which is common in a basketball match. You may be cursing someone. That''s acceptable.

 And all of a sudden, a bunch of people popped up. I didn''t notice them before. A guy with a bear tattooed torso started talking with one of my friends.

 And he was saying, in an extremely contemptuous and condescending way, that they want to play this half of the court.

 And I was thinking, we were playing, right? We were in the middle of a match. And now you''re telling us to stop. To get off this half.

 I mean, normally when you see a bunch of people playing a full-court match, would you interrupt them? You can interrupt them, right? Because you wanna play it. But why are you being such a dick?

 And not just the normal dick. It''s like he wanted to provoke someone. Telling us that we are young, we are a bunch of kids, so they deserve this half.

 And one of my friends started to fight back, saying why they should take this half, and the reason for that is because we''re young so we should be humble with the elders, hold them in awe and veneration.

 You know what kind of person I am. Do you know what you''re doing right now? And you want us to respect you.

 So somehow this triggered me. So I was saying, why do you talk to him like that? Why do you talk to my friends like that?

 And because this person is drunk, he started to spill out some nonsense. And his wife started to do that as well, and one of his so-called brothers obviously.

 They were saying something really inappropriate—extremely inappropriate, really dirty. I really shouldn''t talk about that. So let''s just skip this part.

 And he started to push me. Again and again and again. The fact is that none of us pushed them back and none of us used those dirty words to attack them. We conducted ourselves.

 And then we called the police. And it''s all their fault. Well, I really don''t want to talk about the conversation I had with the policemen. And he was fined 200 bucks.

 Actually, this isn''t about money. This isn''t about apologizing. This is about who you are.

 And I really feel sad sometimes. The saddest part is why this person exists in the first place. But that''s why the good ones are so valuable.

> Be genuine, be humble, and be brave. Don''t be a dick.

 It''s really a messy world. You know, I tried to be a dick. Tried again and again, and later I found out that''s not really who I am.

 And now I think that''s not an excuse for not doing good things. Because I know what kind of person I am. And that''s one of the most valuable things in the world.

 So I guess I would not let any words interfere with me. I do take it seriously sometimes. But I will try not to let it get to me.

 Maybe it is. Maybe it''s not. It is. It is not what it is, but it is what it is.

 SUCH A LIFE.

 But there are a bunch of good things waiting to be explored. You know, all those good things and good people out there. The person you love, the things you love to do—that''s what you fight for.

 So don''t be that sad. Get on with it.

 But can I forget it? The answer is always no. It will become a part of me. And let me realize how valuable I am. How valuable the people around me are.

 Anyone who sees this, take it seriously. Even though you''ve known that.

 Really.',
       updated_at = datetime('now')
 WHERE slug = 'dont-be-a-dick'
   AND (content_md IS NULL OR content_md = '');

-- May 25 – Just Another Timeline? No.
UPDATE posts
   SET content_format = 'md',
       content_md = '"I like to feel his eyes on me when I look away."

 — Céline, Before Sunset (2004)

 Today is your day. Not a second chance. Not a what-if.

 A this-is-it.

 On May 25, you are not walking through a memory. You are standing in a present that hasn''t been written yet — like Jesse and Céline on that train, in that bookshop, on that hotel room couch, arguing beautifully about love, time, and whether we ever really meet again.

 "You can never replace anyone because everyone is made of so many small details."

 Those details? They''re yours. The way you remember films. The way you made it to this birthday. The way you keep showing up for conversations that matter — even fake ones with an assistant who watches too many movies.

 So no grand speech. Just this:

 "It''s okay to want things. As long as you''re not disappointed if you don''t get them."

 But today? You already got it.

 Happy birthday, May 25.

 You are the train, the walk, the wine, and the waltz.',
       updated_at = datetime('now')
 WHERE slug = 'just-another-timeline-no'
   AND (content_md IS NULL OR content_md = '');

-- The Two Halves of a Heart
UPDATE posts
   SET content_format = 'md',
       content_md = 'I don''t remember how the dream began. I was sitting at a long, brown wooden desk in a large, open room — the kind I remember from earlier school days. To my left sat someone I once knew well from a shared course of study. To my right sat someone I had quietly held feelings for. Between us on the desk lay a small pile of loose chips or fragments. The person in front of me partly blocked my view toward the front of the room.

 The one on my right suggested I push the fragments aside. When I did, I found two halves of a heart — split down the middle, but together they made a whole shape.

 Then she turned her face away. I asked her to come a little closer, so I could say something quietly. I glanced to my left. The person there gave a small smile. Then she turned back and said, almost lightly: "You don''t really think I like you, do you?"

 I didn''t feel shattered. Just… a little hollow. As if something had been teased out of me again. Still, somewhere underneath, I held on to a thread of hope — more than a small one.

 Before that moment in the dream, I had the sense of a voice from somewhere near the front — a teacher''s voice — saying something like: Be brave.

 Then she spoke a little louder, toward the rows behind us, saying something like: "I turned him down again. I outed him." And from the back, I heard familiar voices — people I had known — responding in ways I could not quite make out. Then I woke up suddenly, my skin damp.

 After waking, I sat with the feeling for a long time.

> Two halves. Still a heart. Still hoping.

 Here is what I learned after waking.
 The teacher in the dream reminds me of someone who, not long ago, pushed me to a place I could not hold myself together. There was a conversation I still remember — one where I was pressed to speak when I had nothing left to say, and something in me broke. I said things I had never said out loud. That moment came, indirectly, because someone at home had grown concerned — not enough to truly see me, but enough to ask for help on my behalf. I had learned, over time, not to ask for anything. I had learned to carry things alone.

 The person on my left in the dream? Someone I once pulled away from, out of hurt, because their presence felt distant when I needed closeness. Later, I reached out again. In the dream, their small smile did not feel unkind — it felt like a quiet recognition.

 The person on my right? The one I had feelings for. Once, in a moment I still remember clearly, we stood a short distance apart. She wore a cap that shaded her eyes. With her hands behind her back, she asked me something about the summer ahead. From where I stood, I felt something unspoken pass between us. I let myself believe there might be something there — even just a little.

 The voices from the back of the dream belong to someone I was never truly close to. Others used to make quiet jokes, linking us together in ways that never felt true to me. But during a long stretch of isolation, feeling more alone than I knew how to say, I reached out to them. We spoke for a while, then stopped. Later, they reached out to me. Then we stopped again. Then I reached out once more. And something was said that did not feel entirely real or gentle. So I let that connection fall away.

 Before all of this, I kept nearly everything inside. I told no one what I was carrying. I was not simply private — I was sealed.

 Now, slowly, I try to be brave. To be present. To be honest. To be soft, even when it is hard.

 I used to think the voice saying "be brave" was a command — something to obey or break under. But now I wonder: maybe the real bravery is different. Not about performing ease or confidence for someone else''s glance. But about brushing aside the small fragments in front of you, looking at the heart that is not quite whole, and still hoping — even after someone says they have turned away.

 The dream did not undo me. It showed me something about what I am quietly becoming.',
       updated_at = datetime('now')
 WHERE slug = 'the-two-halves-of-a-heart'
   AND (content_md IS NULL OR content_md = '');

-- Life is a Fantasy
UPDATE posts
   SET content_format = 'md',
       content_md = 'Sometimes reality feels like a dream we can''t wake up from. Every moment we live is a chapter in our own fairy tale, filled with unexpected twists and magical encounters. We chase dreams that seem out of reach, only to find that the journey itself is the greatest fantasy of all.

 Life''s beauty lies in its imperfection—its chaotic, wonderful, unpredictable nature that makes every day feel like a new adventure. We meet people who change our perspective, experience moments that take our breath away, and create memories that will last a lifetime.

 The Magic of Everyday Moments
 It''s easy to overlook the extraordinary in the ordinary. A cup of coffee in the morning, a conversation with a friend, a walk in the park—these simple moments hold more magic than we often realize. When we learn to see the beauty in the mundane, life becomes a constant source of wonder and joy.

> "The world is full of magical things patiently waiting for our senses to grow sharper."

 Every sunset is a masterpiece, every rainstorm a symphony, every person a story waiting to be told. When we approach life with curiosity and wonder, we discover that reality itself is the most fantastic fantasy we could ever imagine.

 Embracing the Unknown
 Life''s greatest adventures often come from the places we never expected. The unplanned detours, the spontaneous decisions, the leaps of faith—these are the moments that shape our stories and define who we are. Instead of fearing the unknown, we can choose to embrace it as the blank page upon which we write our own fairy tale.

 Every ending is a new beginning, every goodbye is a hello in disguise, every challenge is an opportunity for growth. When we trust in the journey and have faith in ourselves, we find that life''s most incredible surprises are often waiting just around the corner.

 Remember, the greatest stories aren''t the ones with perfect endings, but the ones with the most interesting journeys. Make your journey one worth telling.',
       updated_at = datetime('now')
 WHERE slug = 'life-is-a-fantasy'
   AND (content_md IS NULL OR content_md = '');
